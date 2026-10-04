import { createClient } from "@supabase/supabase-js";
import {
  fromRow,
  isValidSpaceCode,
  normalizeEntry,
  parseSpaceCode,
  toRow,
  type Entry,
  type EntryRow,
} from "@/app/lib/entry";

// Supabase の鍵はブラウザへ出さない。出入口はこのルートだけ。
// （テーブルは RLS 有効・ポリシー0件なので、公開キーでは誰も読み書きできない）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// 2人・年1,200着を想定した全件同期。これを大きく超えたら差分同期へ切り替える
const MAX_ENTRIES = 20000;
const UPSERT_CHUNK = 500;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return fail("サーバー側の設定が未完了です（環境変数が読めません）", 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("リクエストを読み取れませんでした", 400);
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  const spaceId = parseSpaceCode(String(payload.spaceId ?? ""));
  if (!isValidSpaceCode(spaceId)) {
    return fail("家族コードの形式が正しくありません", 400);
  }

  const incoming = Array.isArray(payload.entries) ? payload.entries : [];
  if (incoming.length > MAX_ENTRIES) {
    return fail("件数が多すぎます", 413);
  }
  // 壊れた1件で同期全体を落とさない。読めたものだけ通す
  const push: Entry[] = incoming
    .map(normalizeEntry)
    .filter((e): e is Entry => e !== null);

  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  // 1) このコードの全件を取る（取り込み判定と返却の両方にこの1回を使う）
  const { data: rows, error: selectError } = await sb
    .from("entries")
    .select("*")
    .eq("space_id", spaceId)
    .limit(MAX_ENTRIES);
  if (selectError) {
    return fail(`読み込みに失敗しました: ${selectError.message}`, 502);
  }

  const merged = new Map<string, Entry>();
  for (const row of (rows ?? []) as EntryRow[]) {
    const entry = fromRow(row);
    if (entry) merged.set(entry.id, entry);
  }

  // 2) 相手より新しいものだけ書き込む（後勝ち。同着なら書かない＝無駄な更新を避ける）
  const toWrite = push.filter((e) => {
    const stored = merged.get(e.id);
    return !stored || e.updatedAt > stored.updatedAt;
  });

  for (let i = 0; i < toWrite.length; i += UPSERT_CHUNK) {
    const chunk = toWrite.slice(i, i + UPSERT_CHUNK).map((e) => toRow(e, spaceId));
    const { error } = await sb.from("entries").upsert(chunk, { onConflict: "id" });
    if (error) {
      return fail(`書き込みに失敗しました: ${error.message}`, 502);
    }
  }
  for (const e of toWrite) merged.set(e.id, e);

  // 3) 統合後の全件を返す。受け取った端末はこれで上書きしてよい
  return Response.json({
    entries: [...merged.values()].sort((a, b) => b.createdAt - a.createdAt),
    syncedAt: Date.now(),
  });
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GARMENT_TYPES,
  buildLine,
  formatSpaceCode,
  isValidSpaceCode,
  newSpaceCode,
  normalizeEntry,
  parseSpaceCode,
  typeOf,
  type Entry,
  type GarmentTypeId,
} from "@/app/lib/entry";

// 100cmを超えることがある部位。この3つに限り「10〜19cm」という実寸は存在しないため、
// 先頭2桁が 1x のときだけ3桁目の入力を待ってから次の欄へ移動する。
// （袖丈15cm・股上15cm・裾幅15cm などは普通にあるので、この扱いに含めない）
const LONG_FIELDS = new Set(["着丈", "総丈", "ウエスト"]);

const STORAGE_KEY = "saisun-entries";
const SPACE_KEY = "saisun-space";
const LAST_SYNC_KEY = "saisun-last-sync";

/** 連続入力の邪魔をしないよう、最後の変更から少し置いてまとめて送る */
const AUTO_SYNC_DELAY_MS = 8000;
/** 画面を切り替えるたびに通信しないための間隔 */
const SYNC_COOLDOWN_MS = 30000;

type SyncState = "idle" | "syncing" | "ok" | "error";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** 同じ1着が両方にあれば更新時刻が新しい方を採用する（後勝ち） */
function mergeEntries(local: Entry[], incoming: Entry[]): Entry[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const e of incoming) {
    const current = byId.get(e.id);
    if (!current || e.updatedAt >= current.updatedAt) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export default function Home() {
  const [tab, setTab] = useState<"input" | "history" | "settings">("input");
  const [typeId, setTypeId] = useState<GarmentTypeId>("tops");
  const [values, setValues] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const [spaceId, setSpaceId] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncError, setSyncError] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(0);
  /** ローカルで変更が起きた印。同期で入ってきた分では上げない（同期ループを防ぐ） */
  const [dirtyAt, setDirtyAt] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // タイマー経由の同期は古いstateを掴みがちなので、最新値はrefで持つ
  const entriesRef = useRef<Entry[]>([]);
  const spaceRef = useRef("");
  const syncingRef = useRef(false);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    spaceRef.current = spaceId;
  }, [spaceId]);

  // ---- 起動時の読み込み ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // 旧データには updatedAt / deleted が無い。normalizeEntry が作成時刻で埋める
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setEntries(
            parsed
              .map(normalizeEntry)
              .filter((e): e is Entry => e !== null)
              .sort((a, b) => b.createdAt - a.createdAt)
          );
        }
      }
    } catch {
      /* 壊れたデータは無視して空から開始 */
    }

    let code = "";
    try {
      code = parseSpaceCode(localStorage.getItem(SPACE_KEY) ?? "");
    } catch {
      /* 読めなければ新規発行に回す */
    }

    // 共有リンク（?code=…）で開かれたとき。12桁を手打ちさせないための入口
    const linked = parseSpaceCode(
      new URLSearchParams(window.location.search).get("code") ?? ""
    );
    if (isValidSpaceCode(linked)) {
      if (!isValidSpaceCode(code)) {
        // まだコードを持たない端末＝招かれた側。そのまま参加させる
        code = linked;
      } else if (linked !== code) {
        // すでに自分のデータがある端末。黙って付け替えない（設定タブで本人に確認させる）
        setCodeInput(formatSpaceCode(linked));
        setTab("settings");
      }
      // コードがURLに残り続けないようにする（履歴・共有からの漏れを減らす）
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (!isValidSpaceCode(code)) {
      code = newSpaceCode();
    }
    try {
      localStorage.setItem(SPACE_KEY, code);
    } catch {
      /* 保存できなくてもこのセッションでは動く */
    }
    setSpaceId(code);
    spaceRef.current = code;
    setLastSyncAt(Number(localStorage.getItem(LAST_SYNC_KEY)) || 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries, loaded]);

  const activeType = typeOf(typeId);
  const visibleEntries = entries.filter((e) => !e.deleted);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  // ---- 同期 ----
  const sync = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const code = spaceRef.current;
      if (!code || syncingRef.current) return;
      syncingRef.current = true;
      setSyncState("syncing");
      setSyncError("");
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId: code, entries: entriesRef.current }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `同期に失敗しました (${res.status})`);
        const incoming = (Array.isArray(json.entries) ? json.entries : [])
          .map(normalizeEntry)
          .filter((e: Entry | null): e is Entry => e !== null);
        // 通信中にこの端末で追加された分を消さないよう、ここでも後勝ちで突き合わせる
        setEntries((prev) => mergeEntries(prev, incoming));
        const at = Number(json.syncedAt) || Date.now();
        setLastSyncAt(at);
        try {
          localStorage.setItem(LAST_SYNC_KEY, String(at));
        } catch {
          /* 保存できなくても同期自体は済んでいる */
        }
        setSyncState("ok");
      } catch (e) {
        setSyncState("error");
        setSyncError(e instanceof Error ? e.message : "同期に失敗しました");
        if (!opts.silent) showToast("同期できませんでした。電波を確認してください");
      } finally {
        syncingRef.current = false;
      }
    },
    [showToast]
  );

  // 起動直後に1回
  useEffect(() => {
    if (loaded && spaceId) void sync({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, spaceId]);

  // ローカルで変更があったら少し置いてまとめて送る
  useEffect(() => {
    if (!dirtyAt) return;
    const t = setTimeout(() => void sync({ silent: true }), AUTO_SYNC_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirtyAt, sync]);

  // 履歴を開いたとき・アプリに戻ってきたときに取りに行く
  useEffect(() => {
    if (!loaded || tab === "input") return;
    if (Date.now() - lastSyncAt < SYNC_COOLDOWN_MS) return;
    void sync({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loaded]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSyncAt < SYNC_COOLDOWN_MS) return;
      void sync({ silent: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [lastSyncAt, sync]);

  // ---- 入力 ----
  function handleValueChange(field: string, index: number, raw: string) {
    const v = raw.replace(/[^0-9.]/g, "");
    setValues((prev) => ({ ...prev, [field]: v }));
    if (!/^\d+$/.test(v)) return; // 小数の入力中は移動しない
    if (LONG_FIELDS.has(field)) {
      // 100cm超がありうる部位。先頭が 1x なら 100〜199 の途中なので3桁目を待つ
      if (/^1\d$/.test(v)) return;
      if (v.length >= 2) inputRefs.current[index + 1]?.focus();
      return;
    }
    // それ以外は従来どおり整数2桁で次の欄へ自動移動
    if (v.length === 2) inputRefs.current[index + 1]?.focus();
  }

  function switchType(next: GarmentTypeId) {
    setTypeId(next);
    setValues({});
  }

  function resetForm() {
    setValues({});
    setMemo("");
    setEditingId(null);
  }

  function handleSave() {
    const filled = activeType.fields.some((f) => values[f]);
    if (!filled) {
      showToast("数値が入力されていません");
      return;
    }
    const now = Date.now();
    if (editingId) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === editingId ? { ...e, typeId, values, memo, updatedAt: now } : e
        )
      );
      showToast("更新しました");
    } else {
      const entry: Entry = {
        id: crypto.randomUUID(),
        typeId,
        values,
        memo,
        createdAt: now,
        copied: false,
        updatedAt: now,
        deleted: false,
      };
      setEntries((prev) => [entry, ...prev]);
      showToast("保存しました。次の1着へ！");
    }
    setDirtyAt(now);
    resetForm();
    inputRefs.current[0]?.focus();
  }

  async function handleCopy(entry: Entry) {
    const line = buildLine(entry);
    try {
      await navigator.clipboard.writeText(line);
    } catch {
      showToast("コピーできませんでした");
      return;
    }
    const now = Date.now();
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id ? { ...e, copied: true, updatedAt: now } : e
      )
    );
    setDirtyAt(now);
    showToast("コピーしました");
  }

  function handleEdit(entry: Entry) {
    setTypeId(entry.typeId);
    setValues(entry.values);
    setMemo(entry.memo);
    setEditingId(entry.id);
    setTab("input");
  }

  function handleDelete(entry: Entry) {
    const label = entry.memo || buildLine(entry);
    if (!confirm(`削除しますか？\n${label}`)) return;
    const now = Date.now();
    // 行ごと消すと、相手の端末の同期で復活してしまう。消した印を立てて共有する
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id ? { ...e, deleted: true, updatedAt: now } : e
      )
    );
    setDirtyAt(now);
    if (editingId === entry.id) resetForm();
  }

  // ---- 設定 ----
  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(spaceId);
      showToast("家族コードをコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  }

  async function handleShareLink() {
    const url = `${window.location.origin}/?code=${spaceId}`;
    // 共有シートが使えればそちら優先（LINE・AirDropへそのまま渡せる）
    if (navigator.share) {
      try {
        await navigator.share({ title: "採寸表ジェネレーター", url });
        return;
      } catch {
        /* 共有をやめただけなのでコピーにも進まない */
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast("共有リンクをコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  }

  function handleJoin() {
    const code = parseSpaceCode(codeInput);
    if (!isValidSpaceCode(code)) {
      showToast("コードは英数字12桁です");
      return;
    }
    if (code === spaceId) {
      showToast("すでにこのコードです");
      return;
    }
    const localCount = entries.filter((e) => !e.deleted).length;
    const warning =
      localCount > 0
        ? `\n\nこの端末にある${localCount}件も相手側に追加されます。`
        : "";
    if (!confirm(`家族コードを ${formatSpaceCode(code)} に切り替えますか？${warning}`))
      return;
    setSpaceId(code);
    spaceRef.current = code;
    try {
      localStorage.setItem(SPACE_KEY, code);
    } catch {
      /* 保存できなくてもこのセッションでは繋がる */
    }
    setLastSyncAt(0);
    setCodeInput("");
    void sync();
  }

  function handleExport() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saisun-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("書き出しました");
  }

  const syncLabel =
    syncState === "syncing"
      ? "同期中…"
      : syncState === "error"
        ? "同期できていません"
        : lastSyncAt
          ? `最終同期 ${formatDate(lastSyncAt)}`
          : "まだ同期していません";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-neutral-50 text-neutral-900">
      {/* タブ */}
      <nav className="sticky top-0 z-10 flex border-b border-neutral-200 bg-white shadow-sm">
        {(
          [
            ["input", "入力"],
            ["history", `履歴 (${visibleEntries.length})`],
            ["settings", "設定"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-4 text-lg font-bold ${
              tab === id
                ? "border-b-4 border-emerald-500 text-emerald-600"
                : "text-neutral-400"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {syncState === "error" && (
        <button
          onClick={() => void sync()}
          className="block w-full bg-amber-100 px-4 py-2 text-left text-sm text-amber-800"
        >
          同期できていません（入力は端末に保存済み）。タップで再試行
        </button>
      )}

      {tab === "input" && (
        <section className="p-4 pb-32">
          {editingId && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
              <span>保存済みの1着を編集中</span>
              <button onClick={resetForm} className="font-bold underline">
                やめる
              </button>
            </div>
          )}

          {/* 種類タブ */}
          <div className="grid grid-cols-4 gap-2">
            {GARMENT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => switchType(t.id)}
                className={`rounded-xl py-3 text-sm font-bold ${
                  typeId === t.id
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-neutral-500 shadow-sm"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 採寸入力（測る順） */}
          <div className="mt-4 space-y-3">
            {activeType.fields.map((field, i) => (
              <label key={field} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-lg font-bold">{field}</span>
                <div className="relative flex-1">
                  <input
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="next"
                    value={values[field] ?? ""}
                    onChange={(e) => handleValueChange(field, i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") inputRefs.current[i + 1]?.focus();
                    }}
                    className="h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-2xl font-bold tracking-wider focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400">
                    cm
                  </span>
                </div>
              </label>
            ))}
          </div>

          {/* メモ */}
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="一言メモ（例：赤チェックネルシャツ）"
            className="mt-4 h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base focus:border-emerald-500 focus:outline-none"
          />

          {/* 保存 */}
          <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t border-neutral-200 bg-white p-4">
            <button
              onClick={handleSave}
              className="h-14 w-full rounded-2xl bg-emerald-500 text-xl font-bold text-white active:bg-emerald-600"
            >
              {editingId ? "更新する" : "保存して次の1着へ"}
            </button>
          </div>
        </section>
      )}

      {tab === "history" && (
        <section className="space-y-3 p-4">
          {visibleEntries.length === 0 && (
            <p className="pt-16 text-center text-neutral-400">
              まだ保存された採寸がありません。
              <br />
              「入力」タブから始めましょう。
            </p>
          )}
          {visibleEntries.map((entry) => (
            <article key={entry.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-emerald-100 px-3 py-0.5 font-bold text-emerald-700">
                  {typeOf(entry.typeId).label}
                </span>
                <span className="text-neutral-400">
                  {formatDate(entry.createdAt)}
                </span>
                {entry.copied && (
                  <span className="ml-auto font-bold text-emerald-500">
                    ✓ コピー済み
                  </span>
                )}
              </div>
              {entry.memo && <p className="mt-2 font-bold">{entry.memo}</p>}
              <p className="mt-1 break-all text-sm text-neutral-600">
                {buildLine(entry)}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleCopy(entry)}
                  className="h-11 flex-1 rounded-xl bg-emerald-500 font-bold text-white active:bg-emerald-600"
                >
                  コピー
                </button>
                <button
                  onClick={() => handleEdit(entry)}
                  className="h-11 w-16 rounded-xl bg-neutral-100 text-sm font-bold text-neutral-600"
                >
                  編集
                </button>
                <button
                  onClick={() => handleDelete(entry)}
                  className="h-11 w-16 rounded-xl bg-neutral-100 text-sm font-bold text-red-500"
                >
                  削除
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "settings" && (
        <section className="space-y-4 p-4 pb-16">
          {/* 共有 */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold">この端末の家族コード</h2>
            <p className="mt-1 text-sm text-neutral-500">
              同じコードを入れた端末どうしで、採寸が両方向に共有されます。
            </p>
            <p className="mt-3 select-all break-all rounded-xl bg-neutral-100 px-4 py-3 text-center text-xl font-bold tracking-widest">
              {spaceId ? formatSpaceCode(spaceId) : "…"}
            </p>
            <button
              onClick={handleShareLink}
              className="mt-3 h-12 w-full rounded-xl bg-emerald-500 font-bold text-white active:bg-emerald-600"
            >
              共有リンクを送る
            </button>
            <button
              onClick={handleCopyCode}
              className="mt-2 h-12 w-full rounded-xl bg-neutral-100 font-bold text-neutral-700"
            >
              コードだけコピー
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              リンクを開いた端末は、このコードに自動でつながります。コードを知る人は採寸データを見られるので、家族以外には送らないでください。
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold">相手のコードにつなぐ</h2>
            <p className="mt-1 text-sm text-neutral-500">
              もう一方の端末でコードをコピーして、ここに貼り付けてください。
            </p>
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="例: ABCD-EFGH-JKLM"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="mt-3 h-12 w-full rounded-xl border border-neutral-300 px-4 text-center text-lg font-bold tracking-widest focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={handleJoin}
              className="mt-2 h-12 w-full rounded-xl bg-neutral-800 font-bold text-white active:bg-neutral-900"
            >
              このコードにつなぐ
            </button>
          </div>

          {/* 同期 */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold">同期</h2>
            <p className="mt-1 text-sm text-neutral-500">{syncLabel}</p>
            {syncState === "error" && syncError && (
              <p className="mt-1 break-all text-sm text-red-600">{syncError}</p>
            )}
            <button
              onClick={() => void sync()}
              disabled={syncState === "syncing"}
              className="mt-3 h-12 w-full rounded-xl bg-emerald-500 font-bold text-white active:bg-emerald-600 disabled:bg-neutral-300"
            >
              今すぐ同期する
            </button>
          </div>

          {/* バックアップ */}
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold">バックアップ</h2>
            <p className="mt-1 text-sm text-neutral-500">
              全{entries.length}件（削除済みを含む）をJSONファイルに書き出します。
            </p>
            <button
              onClick={handleExport}
              className="mt-3 h-12 w-full rounded-xl bg-neutral-100 font-bold text-neutral-700"
            >
              データを書き出す
            </button>
          </div>
        </section>
      )}

      {/* トースト */}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-20 mx-auto w-fit rounded-full bg-neutral-900/90 px-5 py-2.5 font-bold text-white">
          {toast}
        </div>
      )}
    </main>
  );
}

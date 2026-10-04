// 入力画面と同期API（サーバー側）の両方が使う型と変換。
// 片方だけ直すと同期が静かに壊れるので、採寸項目の追加はこのファイルから行う。

export const GARMENT_TYPES = [
  { id: "tops", label: "トップス", fields: ["肩幅", "身幅", "着丈", "袖丈"] },
  {
    id: "pants",
    label: "パンツ",
    fields: ["ウエスト", "わたり幅", "裾幅", "総丈", "股上", "股下"],
  },
  { id: "skirt", label: "スカート", fields: ["ウエスト", "裾幅", "総丈"] },
  {
    id: "onepiece",
    label: "ワンピース",
    fields: ["肩幅", "身幅", "総丈", "袖丈", "裾幅"],
  },
] as const;

export type GarmentTypeId = (typeof GARMENT_TYPES)[number]["id"];

export type Entry = {
  id: string;
  typeId: GarmentTypeId;
  values: Record<string, string>;
  memo: string;
  createdAt: number;
  copied: boolean;
  /** 競合したときに新しい方を採用するための更新時刻（ミリ秒） */
  updatedAt: number;
  /** 消した印。行を消さずに印を立てないと、相手の同期で復活する */
  deleted: boolean;
};

export function typeOf(typeId: GarmentTypeId) {
  return GARMENT_TYPES.find((t) => t.id === typeId) ?? GARMENT_TYPES[0];
}

export function buildLine(entry: Entry): string {
  const parts = typeOf(entry.typeId)
    .fields.filter((f) => entry.values[f])
    .map((f) => `${f}${entry.values[f]}`);
  return `実寸：${parts.join(" ")}`;
}

const TYPE_IDS = new Set<string>(GARMENT_TYPES.map((t) => t.id));

/**
 * 外から来たデータを Entry に整える。
 * - localStorage の既存データ（updatedAt / deleted を持たない）の移行もここが吸収する
 * - 1件でも壊れていたら null を返し、呼び出し側が捨てる（同期全体を巻き込まないため）
 */
export function normalizeEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.typeId !== "string" || !TYPE_IDS.has(r.typeId)) return null;

  const values: Record<string, string> = {};
  if (r.values && typeof r.values === "object") {
    for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) {
      if (typeof v === "string") values[k] = v;
      else if (typeof v === "number") values[k] = String(v);
    }
  }

  const createdAt = Number(r.createdAt);
  const created = Number.isFinite(createdAt) ? createdAt : Date.now();
  const updatedAt = Number(r.updatedAt);

  return {
    id: r.id,
    typeId: r.typeId as GarmentTypeId,
    values,
    memo: typeof r.memo === "string" ? r.memo : "",
    createdAt: created,
    copied: r.copied === true,
    // 既存データには updatedAt が無い。作成時刻で代用すれば、相手側の新しい編集に負ける
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : created,
    deleted: r.deleted === true,
  };
}

/** 家族コード。紛らわしい I O 0 1 を除いた32文字 × 12桁 = 約60ビット */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SPACE_CODE_LENGTH = 12;

export function newSpaceCode(): string {
  const buf = new Uint32Array(SPACE_CODE_LENGTH);
  crypto.getRandomValues(buf);
  // 2^32 は 32 で割り切れるので剰余による偏りは出ない
  return Array.from(buf, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
}

/** 入力されたコードを照合用に揃える（小文字・ハイフン・空白を許す） */
export function parseSpaceCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidSpaceCode(code: string): boolean {
  if (code.length !== SPACE_CODE_LENGTH) return false;
  return [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** 画面表示用に4文字ずつ区切る */
export function formatSpaceCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

// ---- Supabase の行 ⇔ Entry ----

export type EntryRow = {
  id: string;
  space_id: string;
  type_id: string;
  measurements: Record<string, string>;
  memo: string;
  copied: boolean;
  deleted: boolean;
  created_at: number;
  updated_at: number;
};

export function toRow(entry: Entry, spaceId: string): EntryRow {
  return {
    id: entry.id,
    space_id: spaceId,
    type_id: entry.typeId,
    measurements: entry.values,
    memo: entry.memo,
    copied: entry.copied,
    deleted: entry.deleted,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

export function fromRow(row: EntryRow): Entry | null {
  return normalizeEntry({
    id: row.id,
    typeId: row.type_id,
    values: row.measurements,
    memo: row.memo,
    copied: row.copied,
    deleted: row.deleted,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

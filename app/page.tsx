"use client";

import { useEffect, useRef, useState } from "react";

const GARMENT_TYPES = [
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

type GarmentTypeId = (typeof GARMENT_TYPES)[number]["id"];

type Entry = {
  id: string;
  typeId: GarmentTypeId;
  values: Record<string, string>;
  memo: string;
  createdAt: number;
  copied: boolean;
};

const STORAGE_KEY = "saisun-entries";

function typeOf(typeId: GarmentTypeId) {
  return GARMENT_TYPES.find((t) => t.id === typeId) ?? GARMENT_TYPES[0];
}

function buildLine(entry: Entry): string {
  const parts = typeOf(entry.typeId)
    .fields.filter((f) => entry.values[f])
    .map((f) => `${f}${entry.values[f]}`);
  return `実寸：${parts.join(" ")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function Home() {
  const [tab, setTab] = useState<"input" | "history">("input");
  const [typeId, setTypeId] = useState<GarmentTypeId>("tops");
  const [values, setValues] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch {
      /* 壊れたデータは無視して空から開始 */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries, loaded]);

  const activeType = typeOf(typeId);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }

  function handleValueChange(field: string, index: number, raw: string) {
    const v = raw.replace(/[^0-9.]/g, "");
    setValues((prev) => ({ ...prev, [field]: v }));
    // 整数2桁で次の欄へ自動移動（3桁や小数は欄をタップして続入力）
    if (/^\d{2}$/.test(v)) {
      inputRefs.current[index + 1]?.focus();
    }
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
    if (editingId) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === editingId ? { ...e, typeId, values, memo } : e
        )
      );
      showToast("更新しました");
    } else {
      const entry: Entry = {
        id: crypto.randomUUID(),
        typeId,
        values,
        memo,
        createdAt: Date.now(),
        copied: false,
      };
      setEntries((prev) => [entry, ...prev]);
      showToast("保存しました。次の1着へ！");
    }
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
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, copied: true } : e))
    );
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
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    if (editingId === entry.id) resetForm();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-neutral-50 text-neutral-900">
      {/* タブ */}
      <nav className="sticky top-0 z-10 flex border-b border-neutral-200 bg-white shadow-sm">
        {(
          [
            ["input", "入力"],
            ["history", `履歴 (${entries.length})`],
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
                <span className="w-24 shrink-0 text-lg font-bold">
                  {field}
                </span>
                <div className="relative flex-1">
                  <input
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="next"
                    value={values[field] ?? ""}
                    onChange={(e) =>
                      handleValueChange(field, i, e.target.value)
                    }
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
          {entries.length === 0 && (
            <p className="pt-16 text-center text-neutral-400">
              まだ保存された採寸がありません。
              <br />
              「入力」タブから始めましょう。
            </p>
          )}
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-2xl bg-white p-4 shadow-sm"
            >
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
              {entry.memo && (
                <p className="mt-2 font-bold">{entry.memo}</p>
              )}
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

      {/* トースト */}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-20 mx-auto w-fit rounded-full bg-neutral-900/90 px-5 py-2.5 font-bold text-white">
          {toast}
        </div>
      )}
    </main>
  );
}

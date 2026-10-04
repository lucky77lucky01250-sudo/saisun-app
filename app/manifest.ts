import type { MetadataRoute } from "next";

// ホーム画面に追加して「アプリとして」開くための設定。
// ⚠️ iOS Safariはタブで開いたサイトのlocalStorageを7日で消すことがある（ITP）。
//    ホーム画面から開けばその対象外になるので、データ保全の意味でも入れている。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "採寸表ジェネレーター",
    short_name: "採寸",
    description:
      "古着出品の採寸メモをスマホで入力し、出品文用の実寸1行テキストをワンタップコピー",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#10b981",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

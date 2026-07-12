import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });

// 入力画面
await page.goto("https://saisun-app.vercel.app", { waitUntil: "networkidle0" });
await page.screenshot({ path: "/Users/ryu/saisun-app/docs/screenshot.png" });

// 履歴画面（サンプル1件をlocalStorageに入れて撮影）
await page.evaluate(() => {
  localStorage.setItem(
    "saisun-entries",
    JSON.stringify([
      {
        id: "sample",
        typeId: "tops",
        values: { 肩幅: "45", 身幅: "52", 着丈: "70", 袖丈: "58" },
        memo: "赤チェックネルシャツ",
        createdAt: Date.now(),
        copied: true,
      },
    ])
  );
});
await page.reload({ waitUntil: "networkidle0" });
const buttons = await page.$$("nav button");
await buttons[1].click();
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({
  path: "/Users/ryu/saisun-app/docs/screenshot-history.png",
});

await browser.close();
console.log("done");

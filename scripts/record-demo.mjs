import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const dir = "/tmp/reaper-demo-raw";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  const paint = () => {
    if (document.getElementById("demo-cursor")) return;
    const dot = document.createElement("div");
    dot.id = "demo-cursor";
    dot.style.cssText =
      "position:fixed;z-index:99999;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #2ee6ff;border-radius:99px;pointer-events:none;left:80px;top:80px;box-shadow:0 0 0 4px rgba(6,8,10,.35);";
    document.addEventListener("mousemove", (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    });
    document.body?.appendChild(dot);
  };
  if (document.body) paint();
  else document.addEventListener("DOMContentLoaded", paint);
});

const page = await context.newPage();

await page.setContent(`<!doctype html>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%;background:#06080a;color:#f3feff;font-family:"IBM Plex Mono",ui-monospace,monospace;}
  main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;}
  svg{color:#2ee6ff}
  h1{margin:0;font-size:28px;font-weight:500;letter-spacing:.42em;padding-left:.42em}
</style>
<main>
  <svg width="120" height="120" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 3 L27 9.5 V20.5 L16 29 L5 20.5 V9.5 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <path d="M16 8 V22" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M16 15 L23 21" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M3 7 V3 H7 M25 3 H29 V7 M3 25 V29 H7 M25 29 H29 V25" fill="none" stroke="currentColor" stroke-width="1.2"/>
  </svg>
  <h1>REAPER</h1>
</main>`);
await page.waitForTimeout(2600);

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "REAPER" }).waitFor();
await page.waitForTimeout(1400);

async function go(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("missing target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await page.waitForTimeout(280);
  return box;
}

const child = page.getByText("Child REAPER", { exact: true }).first();
await go(child);
await page.mouse.click((await child.boundingBox()).x + 40, (await child.boundingBox()).y + 24);
await page.waitForTimeout(900);
await child.dblclick();
await page.getByText("Inside Child REAPER").waitFor();
await page.waitForTimeout(1600);

const run = page.getByRole("button", { name: "Run", exact: true });
await go(run);
await run.click();
await page.getByText("Done", { exact: true }).waitFor({ timeout: 30000 });
await page.waitForTimeout(2200);

await context.close();
await browser.close();
console.log("recorded");

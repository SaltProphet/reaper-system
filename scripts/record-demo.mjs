import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const dir = "/tmp/reaper-demo-raw";
mkdirSync(dir, { recursive: true });
const cues = [];
const started = Date.now();
const mark = (name) => {
  const t = (Date.now() - started) / 1000;
  cues.push({ name, t });
  console.log(`CUE ${t.toFixed(2)} ${name}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir, size: { width: 1440, height: 900 } },
});
await context.addInitScript(() => {
  const paint = () => {
    if (document.getElementById("demo-cursor")) return;
    const dot = document.createElement("div");
    dot.id = "demo-cursor";
    dot.style.cssText =
      "position:fixed;z-index:99999;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #e85d2a;border-radius:99px;pointer-events:none;left:72px;top:72px;";
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

async function glide(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("missing box");
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(28, box.height / 2), { steps: 14 });
  await page.waitForTimeout(180);
  return box;
}

try {
  mark("desk");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "REAPER" }).waitFor();
  await page.waitForTimeout(1600);

  const box = (name) => page.locator("article").filter({ hasText: name }).first();
  mark("objective");
  await glide(box("Objective"));
  await box("Objective").click();
  await page.waitForTimeout(900);
  mark("research");
  await glide(box("Research"));
  await box("Research").click();
  await page.waitForTimeout(900);
  mark("child");
  await glide(box("Child REAPER"));
  await box("Child REAPER").click();
  await page.waitForTimeout(1100);

  mark("open");
  await box("Child REAPER").dblclick();
  await page.getByText("Recordkeeping", { exact: true }).waitFor();
  await page.waitForTimeout(1400);
  mark("close");
  await box("Child REAPER").dblclick();
  await page.waitForTimeout(900);

  mark("run");
  const run = page.getByRole("button", { name: "Run", exact: true });
  await glide(run);
  await run.click();
  await page.getByText("Running", { exact: true }).waitFor();
  await page.getByText("Done", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);

  mark("swap");
  await box("Child REAPER").click();
  const compact = page.getByRole("button", { name: /Compact pass/ });
  await compact.scrollIntoViewIfNeeded();
  await glide(compact);
  await compact.click();
  await page.getByText("Compact pass").first().waitFor();
  await page.waitForTimeout(900);

  mark("again");
  await run.click();
  await page.getByText("Running", { exact: true }).waitFor();
  await page.getByText("Done", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);

  mark("reject");
  const bad = page.getByRole("button", { name: /Bad ports/ });
  await bad.scrollIntoViewIfNeeded();
  await glide(bad);
  await bad.click();
  await page.getByText("Refused. Ports do not match.").waitFor();
  await page.waitForTimeout(1600);

  mark("tail");
  await page.waitForTimeout(2200);
  mark("end");
  await page.setContent(`<!doctype html>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%;background:#0c0c0b;color:#f2efe8;font-family:"IBM Plex Mono",ui-monospace,monospace;}
  main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;}
  svg{color:#e85d2a}
  h1{margin:6px 0 0;font-size:28px;letter-spacing:.42em;font-weight:500;padding-left:.42em}
  p{margin:0;font-size:16px;color:#c8c4bc}
</style>
<main>
  <svg width="84" height="84" viewBox="0 0 32 32">
    <path d="M16 3 L27 9.5 V20.5 L16 29 L5 20.5 V9.5 Z" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <path d="M16 8 L22 11.5 V18.5 L16 22 L10 18.5 V11.5 Z" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <path d="M3 7 V3 H7 M25 3 H29 V7 M3 25 V29 H7 M25 29 H29 V25" fill="none" stroke="currentColor" stroke-width="1.2"/>
  </svg>
  <h1>REAPER</h1>
  <p>Complexity is internal.</p>
  <p>Compatibility is external.</p>
  <p>Modularity isn't optional.</p>
</main>`);
  await page.waitForTimeout(3600);
  mark("cut");
} finally {
  await context.close();
  await browser.close();
  writeFileSync("/tmp/reaper-cues.json", JSON.stringify(cues));
}

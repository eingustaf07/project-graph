import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import process from "node:process";
import { createRequire } from "node:module";
const loadBrowserPackage = createRequire(import.meta.url);
const { chromium } = loadBrowserPackage("playwright");

async function verify() {
  const output = process.env.PG_SMART_TREE_QA_OUTPUT;
  if (!output) throw new Error("Set PG_SMART_TREE_QA_OUTPUT to an evidence directory");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PG_QA_BROWSER, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1530, height: 1050 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack));
    await page.goto("http://127.0.0.1:1493/qa/smart-tree/index.html");
    await page.waitForFunction(() => !!window.smartTreeQA);
    const snapshot = () => page.evaluate(() => window.smartTreeQA.snapshot());
    const before = await snapshot();
    await page.screenshot({ path: path.join(output, "before-10.png") });
    await page.keyboard.press("Control+Alt+l");
    const after = await snapshot();
    assert.notDeepEqual(after, before);
    assert.deepEqual(await page.evaluate(() => window.smartTreeQA.overlaps()), []);
    await page.screenshot({ path: path.join(output, "after-10.png") });
    await page.locator("#undo").click();
    assert.deepEqual(await snapshot(), before);
    await page.locator("#redo").click();
    assert.deepEqual(await snapshot(), after);
    await page.evaluate(() => window.smartTreeQA.roundTrip());
    assert.deepEqual(await snapshot(), after);
    const directions = [];
    await page.locator("#count").selectOption("100");
    for (const direction of ["right", "left", "up", "down"]) {
      await page.locator("#direction").selectOption(direction);
      await page.locator("#reset").click();
      await page.keyboard.press("Control+Alt+l");
      const arranged = await snapshot();
      for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Alt+l");
      assert.deepEqual(await snapshot(), arranged);
      assert.deepEqual(await page.evaluate(() => window.smartTreeQA.overlaps()), []);
      await page.screenshot({ path: path.join(output, `after-100-${direction}.png`) });
      directions.push({ direction, stableAfterTenRuns: true, status: await page.locator("#status").textContent() });
    }
    assert.deepEqual(errors, []);
    const result = {
      actualPGNodesAndCanvas: true,
      nativeDesktopHost: false,
      keyboard: true,
      undo: true,
      redo: true,
      msgpackRoundTrip: true,
      directions,
      errors,
    };
    await fs.writeFile(path.join(output, "visual-results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

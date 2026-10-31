import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const output = process.env.PG13_QA_OUTPUT;
if (!output) throw new Error("Set PG13_QA_OUTPUT");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PG_QA_BROWSER, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1480, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack));
  await page.goto("http://127.0.0.1:1494/qa/pg13/doodles.html?pen");
  await page.waitForFunction(() => !!window.doodleQA);
  const names = await page
    .locator("aside[aria-label='涂鸦面板'] button")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
  assert.deepEqual(names.slice(0, 7), ["橡皮模式", "涂鸦参数", "容器模式", "涂鸦模式", "直线涂鸦", "长方形", "圆形"]);
  assert.equal(
    await page.getByRole("button", { name: "容器模式", exact: true }).locator("svg.lucide-square").count(),
    1,
  );
  assert.equal(
    await page.getByRole("button", { name: "涂鸦模式", exact: true }).locator("svg.lucide-frame").count(),
    1,
  );
  const run = async (action) => {
    await page.evaluate((action) => window.doodleQA.runCommand(action), action);
    await page.waitForTimeout(50);
  };
  await run("parameters");
  assert.ok(await page.getByLabel("橡皮大小", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window.doodleQA.settings.mouseLeftMode = "selectAndMove"));
  await run("eraser");
  assert.equal(await page.getByRole("switch", { name: "橡皮模式", exact: true }).getAttribute("aria-checked"), "true");
  assert.equal(await page.evaluate(() => window.doodleQA.settings.mouseLeftMode), "draw");
  await run("line");
  assert.equal(await page.getByRole("switch", { name: "橡皮模式", exact: true }).getAttribute("aria-checked"), "false");
  assert.equal(await page.getByRole("switch", { name: "直线涂鸦", exact: true }).getAttribute("aria-checked"), "true");
  await page.getByRole("switch", { name: "直线涂鸦", exact: true }).click();
  await run("container");
  assert.equal(await page.getByRole("button", { name: "容器模式", exact: true }).getAttribute("aria-pressed"), "true");
  await run("decoration");
  assert.equal(await page.getByRole("button", { name: "涂鸦模式", exact: true }).getAttribute("aria-pressed"), "true");
  for (const [action, from, to] of [
    ["rectangle", [100, 150], [400, 350]],
    ["circle", [650, 150], [900, 400]],
  ]) {
    await run(action);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal((await page.evaluate(() => window.doodleQA.shapes())).at(-1).shape, action);
    await page.mouse.click(1200, 850);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "toolbar-order-and-tool-commands.png") });
  await fs.writeFile(
    path.join(output, "toolbar-commands-result.json"),
    JSON.stringify({ passed: true, names, shapes: await page.evaluate(() => window.doodleQA.shapes()) }, null, 2),
  );
  console.log("Toolbar order, icons and real tool command checks passed");
} finally {
  await browser.close();
}

import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import process from "node:process";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const output = process.env.PG13_QA_OUTPUT;
if (!output) throw new Error("Set PG13_QA_OUTPUT to an evidence directory");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PG_QA_BROWSER, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1530, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack));
  await page.goto("http://127.0.0.1:1494/qa/pg13/index.html");
  await page.waitForFunction(() => !!window.pg13QA);
  await page.waitForSelector("canvas");
  const ids = await page.evaluate(() => ({ first: window.pg13QA.first.id, second: window.pg13QA.second.id }));
  const snapshot = (id) => page.evaluate((value) => window.pg13QA.snapshot(value), id);
  const original = await snapshot(ids.first);
  await page.keyboard.press("Control+c");
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: path.join(output, "copy-mode-dialog.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.pgClipboard), undefined);
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "复制节点", exact: true }).click();
  await page.waitForFunction(() => !!window.pgClipboard);
  await page.evaluate((id) => window.pg13QA.focus(id), ids.second);
  await page.locator("canvas").click({ position: { x: 650, y: 400 } });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 5);
  const center = await page.evaluate((id) => window.pg13QA.center(id), ids.second);
  assert.ok(Math.abs(center.x - 812.5) < 0.01 && Math.abs(center.y - 500) < 0.01);
  await page.screenshot({ path: path.join(output, "cross-file-centered.png") });
  assert.deepEqual(await snapshot(ids.first), original);
  const pasted = await snapshot(ids.second);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 0);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 5);
  assert.deepEqual(await snapshot(ids.second), pasted);
  await page.locator(`[data-pg-docked-tab-id="${ids.second}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "向右拆分" }).click();
  await page.waitForFunction(() => window.pg13QA.groups().length === 2);
  await page.screenshot({ path: path.join(output, "before-merge.png") });
  await page.locator(`[data-pg-docked-tab-id="${ids.second}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "合并文件分栏" }).click();
  await page.waitForFunction(() => window.pg13QA.groups().length === 1);
  assert.deepEqual(await snapshot(ids.first), original);
  assert.deepEqual(await snapshot(ids.second), pasted);
  assert.equal(await page.evaluate(() => window.pg13QA.instancesIntact()), true);
  await page.screenshot({ path: path.join(output, "after-merge.png") });
  await page.locator(`[data-pg-docked-tab-id="${ids.second}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "向下拆分" }).click();
  await page.waitForFunction(() => window.pg13QA.groups().length === 2);
  await page.locator(`[data-pg-docked-tab-id="${ids.first}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "合并文件分栏" }).click();
  await page.waitForFunction(() => window.pg13QA.groups().length === 1);
  await page.evaluate((id) => window.pg13QA.focus(id), ids.first);
  await page.keyboard.press("Control+c");
  await page.getByRole("button", { name: "复制文本", exact: true }).click();
  await page.waitForFunction(() => !window.pgClipboard.startsWith("ProjectGraphClipboard/"));
  assert.match(await page.evaluate(() => window.pgClipboard), /原始节点树/);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "copy chooser",
          "Escape cancellation",
          "cross-document centered paste",
          "original unchanged",
          "undo",
          "redo",
          "horizontal split merge",
          "vertical split merge",
          "same document instances",
          "plain-text copy",
          "no browser errors",
        ],
        center,
      },
      null,
      2,
    ),
  );
  console.log("PG1.3 browser checks passed");
} finally {
  await browser.close();
}

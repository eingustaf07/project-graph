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
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  await page.goto("http://127.0.0.1:1494/qa/pg13/doodles.html?pen");
  await page.waitForFunction(() => !!window.doodleQA);
  await page.waitForTimeout(50);
  await page.evaluate(() => (window.doodleQA.settings.mouseLeftMode = "selectAndMove"));
  await page.locator("canvas").dblclick({ position: { x: 180, y: 700 } });
  const originalNodes = await page.evaluate(() => window.doodleQA.nodes());
  await page.getByRole("switch", { name: "直线涂鸦", exact: true }).click();
  assert.equal(await page.evaluate(() => window.doodleQA.settings.mouseLeftMode), "selectAndMove");
  await page.getByRole("button", { name: "涂鸦参数", exact: true }).click();
  await page.getByLabel("涂鸦笔迹颜色", { exact: true }).fill("#e51b32");
  await page.getByLabel("涂鸦不透明度", { exact: true }).fill("65");
  await page.getByLabel("直线涂鸦粗细", { exact: true }).fill("10");
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window.doodleQA.settings.mouseLeftMode = "draw"));
  await page.mouse.move(100, 150);
  await page.mouse.down();
  await page.mouse.move(250, 350);
  await page.mouse.move(500, 210);
  await page.waitForTimeout(100);
  const preview = await page.evaluate(() => {
    const d = window.doodleQA.project.controller.penStrokeDrawing;
    return d.getStraightLinePreview(d.currentSegments[1].location).map((v) => [v.x, v.y]);
  });
  assert.deepEqual(preview, [
    [100, 150],
    [500, 210],
  ]);
  await page.screenshot({ path: path.join(output, "straight-line-preview.png") });
  await page.mouse.up();
  await page.waitForFunction(() => window.doodleQA.strokes().length === 1);
  let strokes = await page.evaluate(() => window.doodleQA.strokes());
  assert.equal(strokes[0].segments.length, 2);
  assert.equal(strokes[0].segments[0].x, 100);
  assert.equal(strokes[0].segments[1].x, 500);
  assert.deepEqual(strokes[0].color, [229, 27, 50, 0.65]);
  assert.equal(strokes[0].segments[0].pressure, 2);
  await page.keyboard.down("Shift");
  await page.mouse.move(150, 420);
  await page.mouse.down();
  await page.mouse.move(490, 700, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForFunction(() => window.doodleQA.strokes().length === 2);
  strokes = await page.evaluate(() => window.doodleQA.strokes());
  const d = strokes[1].segments;
  assert.ok(Math.abs(d[1].x - d[0].x - (d[1].y - d[0].y)) < 1e-6);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.doodleQA.strokes().length === 1);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => window.doodleQA.strokes().length === 2);
  await page.getByRole("switch", { name: "直线涂鸦", exact: true }).click();
  await page.mouse.move(650, 150);
  await page.mouse.down();
  await page.mouse.move(710, 240, { steps: 5 });
  await page.mouse.move(830, 140, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => window.doodleQA.strokes().length === 3);
  strokes = await page.evaluate(() => window.doodleQA.strokes());
  assert.ok(strokes[2].segments.length > 2);
  assert.deepEqual(strokes[2].color, [229, 27, 50, 0.65]);
  await page.evaluate(() => window.doodleQA.reload());
  assert.deepEqual(await page.evaluate(() => window.doodleQA.strokes()), strokes);
  assert.deepEqual(await page.evaluate(() => window.doodleQA.nodes()), originalNodes);
  await page.screenshot({ path: path.join(output, "colored-lines-and-freehand.png") });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "pen-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "sidebar mode does not change mouse mode",
          "exact press/release line",
          "custom color opacity width",
          "Shift 45 degree",
          "freehand retained",
          "undo redo",
          "binary reload",
          "original nodes unchanged",
          "no runtime errors",
        ],
        strokes,
        preview: !!preview,
      },
      null,
      2,
    ),
  );
  console.log("Straight and colored pen browser checks passed");
} finally {
  await browser.close();
}

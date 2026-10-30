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
  const pixel = (x, y) =>
    page.evaluate(({ x, y }) => [...document.querySelector("canvas").getContext("2d").getImageData(x, y, 1, 1).data], {
      x,
      y,
    });
  const drag = async (a, b) => {
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(80);
  };
  await page.getByRole("switch", { name: "直线涂鸦", exact: true }).click();
  const fillParameter = async (name, value) => {
    if (!(await page.getByLabel(name, { exact: true }).isVisible()))
      await page.getByRole("button", { name: "涂鸦参数", exact: true }).click();
    await page.getByLabel(name, { exact: true }).fill(value);
    await page.keyboard.press("Escape");
  };
  await page.getByRole("button", { name: "涂鸦参数", exact: true }).click();
  await page.getByLabel("涂鸦笔迹颜色", { exact: true }).fill("#e51b32");
  await page.getByLabel("直线涂鸦粗细", { exact: true }).fill("10");
  await page.keyboard.press("Escape");
  await drag([100, 200], [550, 200]);
  await page.getByRole("switch", { name: "直线涂鸦", exact: true }).click();
  await page.mouse.move(100, 450);
  await page.mouse.down();
  await page.mouse.move(200, 510, { steps: 6 });
  await page.mouse.move(300, 450, { steps: 6 });
  await page.mouse.move(450, 510, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    window.pgClipboard = "image metadata";
    window.pgClipboardImage = {
      width: 240,
      height: 160,
      rgba: Array.from({ length: 240 * 160 }, () => [20, 140, 220, 255]).flat(),
    };
  });
  await page.mouse.move(850, 250);
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() =>
    window.doodleQA.project.stageManager.getImageNodes().some((n) => n.state === "success"),
  );
  await page.evaluate(() => (window.doodleQA.settings.mouseLeftMode = "selectAndMove"));
  await page.locator("canvas").dblclick({ position: { x: 800, y: 800 } });
  await page.locator("canvas").dblclick({ position: { x: 300, y: 800 } });
  await page.evaluate(() => (window.doodleQA.settings.mouseLeftMode = "draw"));
  const before = await page.evaluate(() => window.doodleQA.snapshot());
  const strokeIds = await page.evaluate(() => window.doodleQA.strokes().map((s) => s.id));
  assert.deepEqual(await pixel(300, 200), [229, 27, 50, 255]);
  assert.deepEqual(await pixel(850, 250), [20, 140, 220, 255]);
  await page.screenshot({ path: path.join(output, "eraser-before.png") });
  await page.getByRole("switch", { name: "橡皮模式", exact: true }).click();
  await fillParameter("橡皮大小", "40");
  await fillParameter("橡皮大小", "4");
  await page.mouse.click(200, 196);
  await page.waitForTimeout(80);
  assert.deepEqual(await pixel(200, 196), [20, 20, 20, 255]);
  assert.deepEqual(await pixel(200, 202), [229, 27, 50, 255]);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(80);
  assert.deepEqual(await pixel(200, 196), [229, 27, 50, 255]);
  await fillParameter("橡皮大小", "40");
  await page.mouse.move(300, 170);
  await page.mouse.down();
  await page.mouse.move(300, 230, { steps: 8 });
  await page.waitForTimeout(80);
  assert.deepEqual(await pixel(300, 200), [20, 20, 20, 255], "Local eraser must preview before release");
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.deepEqual(await pixel(300, 200), [20, 20, 20, 255]);
  assert.deepEqual(await pixel(200, 200), [229, 27, 50, 255]);
  assert.deepEqual(await pixel(450, 200), [229, 27, 50, 255]);
  assert.deepEqual(
    await page.evaluate(() => window.doodleQA.strokes().map((s) => s.id)),
    strokeIds,
    "Erasing a part must not delete or replace a stroke",
  );
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), before);
  assert.deepEqual(await pixel(300, 200), [229, 27, 50, 255]);
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(100);
  assert.deepEqual(await pixel(300, 200), [20, 20, 20, 255]);
  await page.mouse.click(850, 250);
  await page.waitForTimeout(100);
  assert.deepEqual(await pixel(850, 250), [20, 20, 20, 255]);
  assert.deepEqual(await pixel(770, 250), [20, 140, 220, 255]);
  assert.equal(await page.evaluate(() => window.doodleQA.images().length), 1);
  // Freehand is also erased locally, at a confirmed painted pixel rather than its unsmoothed control polygon.
  const freePoint = await page.evaluate(() => {
    const ctx = document.querySelector("canvas").getContext("2d");
    for (let y = 430; y < 530; y++) {
      const p = ctx.getImageData(300, y, 1, 1).data;
      if (p[0] > 200 && p[1] < 60) return [300, y];
    }
    throw new Error("No freehand pixel found");
  });
  await page.mouse.click(...freePoint);
  await page.waitForTimeout(100);
  assert.deepEqual(await pixel(...freePoint), [20, 20, 20, 255]);
  assert.equal(await page.evaluate(() => window.doodleQA.strokes().length), 2);
  await page.mouse.click(800, 800);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.doodleQA.nodes().length), 1);
  assert.equal((await page.evaluate(() => window.doodleQA.nodes()))[0].x < 500, true);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.doodleQA.nodes().length), 2);
  await fillParameter("橡皮大小", "80");
  await page.mouse.click(920, 250);
  await page.waitForTimeout(100);
  assert.deepEqual(await pixel(920, 250), [20, 20, 20, 255]);
  assert.deepEqual(await pixel(875, 250), [20, 140, 220, 255]);
  await page.evaluate(() => {
    const p = window.doodleQA.project,
      n = p.stageManager.getImageNodes()[0],
      delta = p.camera.location.clone();
    delta.x = 80;
    delta.y = 200;
    n.move(delta);
    n.scaleUpdate(0.5);
    p.historyManager.recordStep();
  });
  await page.waitForTimeout(100);
  const movedHole = await page.evaluate(() => {
    const p = window.doodleQA.project,
      n = p.stageManager.getImageNodes()[0],
      f = n.eraserBounds,
      m = n.erasures[0],
      v = p.camera.location.clone();
    v.x = f.left + m.points[0][0] * f.width;
    v.y = f.top + m.points[0][1] * f.height;
    return [v.x, v.y];
  });
  assert.deepEqual(await pixel(...movedHole), [20, 20, 20, 255]);
  const persisted = await page.evaluate(() => window.doodleQA.snapshot());
  await page.evaluate(() => window.doodleQA.reload());
  await page.waitForFunction(() =>
    window.doodleQA.project.stageManager.getImageNodes().every((n) => n.state === "success"),
  );
  await page.waitForTimeout(80);
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), persisted);
  assert.deepEqual(await pixel(...movedHole), [20, 20, 20, 255]);
  await page.screenshot({ path: path.join(output, "eraser-after.png") });
  const png = await page.evaluate(async () => {
    const node = window.doodleQA.project.stageManager.getImageNodes()[0],
      blob = await node.getVisibleBlob(),
      bitmap = await createImageBitmap(blob),
      canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const p = node.erasures[0].points[0];
    const hole = [...ctx.getImageData(Math.floor(p[0] * canvas.width), Math.floor(p[1] * canvas.height), 1, 1).data],
      retained = [...ctx.getImageData(5, 5, 1, 1).data];
    bitmap.close();
    return { type: blob.type, hole, retained };
  });
  assert.equal(png.type, "image/png");
  assert.equal(png.hole[3], 0);
  assert.deepEqual(png.retained, [20, 140, 220, 255]);
  // Copying a masked image keeps the edit when pasted as another PG node.
  await page.evaluate(async () => {
    const p = window.doodleQA.project;
    p.stageManager.clearSelectAll();
    p.stageManager.getImageNodes()[0].isSelected = true;
    await p.copyEngine.copy("nodes");
  });
  await page.mouse.move(500, 700);
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.doodleQA.images().length === 2);
  await page.waitForTimeout(80);
  const copied = await page.evaluate(() => {
    const p = window.doodleQA.project,
      [a, b] = p.stageManager.getImageNodes(),
      f = b.eraserBounds,
      m = b.erasures[0];
    return {
      a: a.uuid,
      b: b.uuid,
      sameMask: JSON.stringify(a.erasures) === JSON.stringify(b.erasures),
      hole: [f.left + m.points[0][0] * f.width, f.top + m.points[0][1] * f.height],
    };
  });
  assert.notEqual(copied.a, copied.b);
  assert.ok(copied.sameMask);
  assert.deepEqual(await pixel(...copied.hole), [20, 20, 20, 255]);
  // Production canvases scale their context for high-DPI displays.
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas.width *= 2;
    canvas.height *= 2;
    canvas.getContext("2d").scale(2, 2);
  });
  await page.waitForTimeout(80);
  const hiDpi = await page.evaluate(
    ([x, y]) => [
      ...document
        .querySelector("canvas")
        .getContext("2d")
        .getImageData(Math.floor(x * 2), Math.floor(y * 2), 1, 1).data,
    ],
    copied.hole,
  );
  assert.deepEqual(hiDpi, [20, 20, 20, 255]);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "eraser-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "live local stroke preview",
          "straight stroke portions retained",
          "image partial erase",
          "freehand partial erase",
          "whole node removal",
          "one-gesture undo redo",
          "adjustable brush diameter",
          "erasure follows image move and scale",
          "MsgPack restore",
          "transparent PNG output used by image copy export and recognition",
          "masked image node copy and paste",
          "high DPI masking",
          "no unhandled errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Partial eraser browser pixel checks passed");
} finally {
  await browser.close();
}

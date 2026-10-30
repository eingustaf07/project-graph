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
  const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  await page.goto("http://127.0.0.1:1494/qa/pg13/doodles.html?zoom");
  await page.waitForFunction(() => !!window.doodleQA);
  await page.locator("canvas").dblclick({ position: { x: 300, y: 280 } });
  const unchanged = await page.evaluate(() => window.doodleQA.snapshot());
  const settings = await page.evaluate(() => JSON.stringify(window.doodleQA.settings));
  await page.screenshot({ path: path.join(output, "pointer-zoom-before.png") });
  const measure = () =>
    page.evaluate(() => {
      const p = window.doodleQA.project,
        at = p.canvas.clientToView(window.zoomClient.x, window.zoomClient.y),
        world = p.renderer.transformView2World(at);
      return { x: world.x, y: world.y, scale: p.camera.currentScale, target: p.camera.targetScale };
    });
  const zoom = async (x, y, delta) => {
    await page.evaluate(
      ({ x, y }) => {
        window.zoomClient = { x, y };
      },
      { x, y },
    );
    const before = await measure();
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, delta);
    await page.keyboard.up("Control");
    await page.waitForFunction((target) => window.doodleQA.project.camera.targetScale !== target, before.target);
    await page.waitForTimeout(350);
    const after = await measure();
    assert.ok(
      Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6,
      JSON.stringify({ before, after }),
    );
    assert.ok(delta < 0 ? after.scale > before.scale : after.scale < before.scale);
  };
  await zoom(800, 220, -120);
  await zoom(1100, 750, 120);
  await zoom(700, 180, -3);
  // A CSS-scaled and offset document pane must use local canvas coordinates once.
  await page.locator("main").evaluate((el) => {
    el.style.marginLeft = "120px";
    el.style.marginTop = "60px";
    el.style.transformOrigin = "top left";
    el.style.transform = "scale(0.8)";
  });
  await zoom(760, 300, -120);
  await page.screenshot({ path: path.join(output, "pointer-zoom-after.png") });
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), unchanged);
  assert.equal(await page.evaluate(() => JSON.stringify(window.doodleQA.settings)), settings);
  // The existing selected-image Ctrl-wheel handler keeps resizing the image only.
  await page.evaluate(() => {
    window.pgClipboardImage = {
      width: 120,
      height: 80,
      rgba: Array.from({ length: 120 * 80 }, () => [20, 140, 220, 255]).flat(),
    };
    window.pgClipboard = "image metadata";
  });
  await page.mouse.move(500, 500);
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.doodleQA.images().length === 1);
  const imageBefore = await page.evaluate(() => {
    const p = window.doodleQA.project,
      n = p.stageManager.getImageNodes()[0],
      r = n.rectangle,
      view = p.renderer.transformWorld2View(r.center),
      rect = p.canvas.element.getBoundingClientRect();
    return {
      imageScale: n.scale,
      cameraScale: p.camera.currentScale,
      target: p.camera.targetScale,
      x: rect.left + (view.x * rect.width) / p.canvas.element.clientWidth,
      y: rect.top + (view.y * rect.height) / p.canvas.element.clientHeight,
    };
  });
  await page.mouse.move(imageBefore.x, imageBefore.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  const imageAfter = await page.evaluate(() => {
    const p = window.doodleQA.project;
    return {
      imageScale: p.stageManager.getImageNodes()[0].scale,
      cameraScale: p.camera.currentScale,
      target: p.camera.targetScale,
    };
  });
  assert.ok(imageAfter.imageScale > imageBefore.imageScale);
  assert.equal(imageAfter.target, imageBefore.target);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "pointer-zoom-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "blank Ctrl wheel in and out",
          "small wheel delta",
          "moving pointer anchor",
          "offset and CSS-scaled pane",
          "unchanged node data and settings",
          "image Ctrl wheel preserved",
        ],
        imageBefore,
        imageAfter,
      },
      null,
      2,
    ),
  );
  console.log("Pointer-centered canvas zoom browser checks passed");
} finally {
  await browser.close();
}

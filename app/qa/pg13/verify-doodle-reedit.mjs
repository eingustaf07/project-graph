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
  const button = (name) => page.getByRole("button", { name, exact: true });
  const shapes = () => page.evaluate(() => window.doodleQA.shapes());
  const handles = () => page.getByRole("button", { name: /^调整[上下][左右]角$/ });
  const drag = async (from, to) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  const finish = async () => {
    await page.mouse.click(1200, 850);
    await page.waitForTimeout(100);
    assert.equal(await handles().count(), 0);
  };
  const openTitle = async (x) => {
    await page.mouse.click(x, 100);
    await page.waitForTimeout(100);
    assert.equal(await handles().count(), 4);
    await button("涂鸦参数").click();
    return page.getByLabel("图形或容器名称");
  };
  for (const [mode, from, to] of [
    ["容器模式", [100, 100], [450, 350]],
    ["涂鸦模式", [650, 100], [1000, 350]],
  ]) {
    await button(mode).click();
    await button("长方形").click();
    await drag(from, to);
    await finish();
  }
  assert.deepEqual(
    (await shapes()).map((shape) => shape.name),
    ["", ""],
  );
  for (const [index, x, end] of [
    [0, 250, [500, 400]],
    [1, 800, [1050, 400]],
    [0, 250, [550, 450]],
  ]) {
    await page.mouse.click(x, 100);
    await page.waitForTimeout(100);
    assert.equal(await handles().count(), 4);
    const before = await shapes();
    const corner = await button("调整下右角").boundingBox();
    await drag([corner.x + corner.width / 2, corner.y + corner.height / 2], end);
    await finish();
    const after = await shapes();
    assert.equal(after[index].rect.width, end[0] - after[index].rect.x);
    assert.equal(after[index].rect.height, end[1] - after[index].rect.y);
    assert.deepEqual(after[1 - index], before[1 - index]);
  }
  await (await openTitle(250)).fill("研究区");
  await finish();
  assert.equal((await shapes())[0].name, "研究区");
  await (await openTitle(250)).fill("");
  await finish();
  assert.equal((await shapes())[0].name, "");
  await page.keyboard.press("Control+z");
  assert.equal((await shapes())[0].name, "研究区");
  await page.keyboard.press("Control+y");
  assert.equal((await shapes())[0].name, "");
  const snapshot = await shapes();
  await page.evaluate(() => window.doodleQA.reload());
  assert.deepEqual(await shapes(), snapshot);
  assert.equal(
    await page.evaluate(() => window.doodleQA.strokes().length),
    0,
    "selecting old frames in drawing mode must not create strokes",
  );
  assert.equal(await page.evaluate(() => window.doodleQA.settings.mouseLeftMode), "draw");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "multiple-untitled-frames.png") });
  await fs.writeFile(
    path.join(output, "doodle-reedit-result.json"),
    JSON.stringify(
      {
        passed: true,
        shapes: snapshot,
        checks: [
          "repeatedly resize either frame in drawing mode",
          "unselected frame unchanged",
          "default empty title",
          "rename and clear title",
          "undo redo",
          "binary reload",
          "drawing mode unchanged and no extra strokes",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Multiple doodle re-edit and optional title browser checks passed");
} finally {
  await browser.close();
}

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
  page.on("pageerror", (e) => errors.push(e.stack));
  await page.goto("http://127.0.0.1:1494/qa/pg13/doodles.html");
  await page.waitForFunction(() => !!window.doodleQA);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const openParameters = async () => {
    if (!(await page.getByLabel("涂鸦线条颜色", { exact: true }).isVisible())) await button("涂鸦参数").click();
  };
  const finishEditing = async (valid = true) => {
    await page.mouse.click(1200, 880);
    await page.waitForTimeout(100);
    if (valid) assert.equal(await page.getByRole("button", { name: /^调整[上下][左右]角$/ }).count(), 0);
  };
  const rail = await page.getByRole("complementary", { name: "涂鸦面板" }).boundingBox();
  assert.equal(rail.width, 44);
  assert.ok(Math.abs(rail.x + rail.width - 1442) < 1);
  assert.ok(Math.abs(rail.y + rail.height / 2 - 465) < 1);
  const shapes = () => page.evaluate(() => window.doodleQA.shapes());
  const nodes = () => page.evaluate(() => window.doodleQA.nodes());
  const drag = async (a, b) => {
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  const draw = async (mode, shape, a, b) => {
    await button(mode).click();
    await button(shape).click();
    await drag(a, b);
  };
  const contains = (shape, n) => {
    const r = shape.rect;
    if (shape.shape === "circle") {
      for (const x of [n.x, n.x + n.width])
        for (const y of [n.y, n.y + n.height])
          assert.ok(Math.hypot(x - r.x - r.width / 2, y - r.y - r.height / 2) <= r.width / 2 - 7.9);
    } else {
      assert.ok(
        n.x >= r.x + 7.9 &&
          n.y >= r.y + 7.9 &&
          n.x + n.width <= r.x + r.width - 7.9 &&
          n.y + n.height <= r.y + r.height - 7.9,
      );
    }
  };
  assert.equal(await page.getByRole("button", { name: /画笔|自由绘制/ }).count(), 0);
  await draw("涂鸦模式", "长方形", [60, 70], [430, 350]);
  assert.ok(
    await page.evaluate(() => {
      const ctx = document.querySelector("canvas").getContext("2d");
      for (let x = 90; x < 410; x++) if (ctx.getImageData(x, 70, 1, 1).data[1] < 100) return false;
      return true;
    }),
    "selected doodle border must be continuously solid",
  );
  assert.equal(await button("固定边界").count(), 0);
  assert.equal(await button("保存图形参数").count(), 0);
  await finishEditing();
  const afterOutside = await page.evaluate(() => window.doodleQA.snapshot());
  await page.keyboard.press("Control+z");
  assert.equal((await shapes()).length, 0, "finishing unchanged geometry must not add a redundant undo step");
  await page.keyboard.press("Control+y");
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), afterOutside);
  await page.mouse.click(200, 70);
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: /^调整[上下][左右]角$/ }).count(), 4);
  await page.getByRole("switch", { name: "橡皮模式", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^调整[上下][左右]角$/ }).count(), 0);
  await page.getByRole("switch", { name: "橡皮模式", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^调整[上下][左右]角$/ }).count(), 0);
  await page.locator("canvas").dblclick({ position: { x: 180, y: 180 } });
  assert.equal((await nodes())[0].parent, undefined);
  await drag([200, 200], [470, 430]);
  assert.equal((await nodes())[0].parent, undefined);
  await draw("容器模式", "长方形", [480, 70], [1000, 600]);
  await openParameters();
  await page.getByLabel("图形或容器名称").fill("固定知识区");
  await finishEditing();
  await page.locator("canvas").dblclick({ position: { x: 700, y: 260 } });
  let cage = (await shapes())[1],
    member = (await nodes())[1];
  assert.equal(member.parent, cage.id);
  await drag([member.x + 20, member.y + 20], [1150, 750]);
  cage = (await shapes())[1];
  member = (await nodes())[1];
  contains(cage, member);
  assert.equal(cage.rect.width, 520);
  assert.equal(cage.name, "固定知识区");
  await page.mouse.click(740, 70);
  await page.waitForTimeout(150);
  await openParameters();
  await page.getByLabel("图形宽度").fill("580");
  await finishEditing();
  assert.equal((await shapes())[1].rect.width, 580);
  await page.mouse.click(740, 70);
  await page.waitForTimeout(150);
  const handle = page.getByRole("button", { name: "调整下右角" });
  const box = await handle.boundingBox();
  await drag([box.x + box.width / 2, box.y + box.height / 2], [1100, 650]);
  await finishEditing();
  assert.equal((await shapes())[1].rect.width, 620);
  contains((await shapes())[1], (await nodes())[1]);
  await page.mouse.click(740, 70);
  await page.waitForTimeout(150);
  await openParameters();
  await page.getByLabel("图形宽度").fill("40");
  await page.getByLabel("图形高度").fill("40");
  const beforeShrink = await shapes();
  await finishEditing(false);
  assert.deepEqual(await shapes(), beforeShrink);
  await page.getByLabel("图形宽度").fill("620");
  await page.getByLabel("图形高度").fill("580");
  await finishEditing();
  await page.screenshot({ path: path.join(output, "rectangle-container.png") });
  await draw("容器模式", "圆形", [40, 440], [430, 830]);
  await openParameters();
  await page.getByLabel("图形或容器名称").fill("圆形知识区");
  await finishEditing();
  await page.locator("canvas").dblclick({ position: { x: 220, y: 620 } });
  const circle = (await shapes())[2];
  let circular = (await nodes()).at(-1);
  assert.equal(circular.parent, circle.id);
  await drag([circular.x + 20, circular.y + 20], [480, 900]);
  circular = (await nodes()).at(-1);
  contains(circle, circular);
  assert.ok(
    (await page.evaluate(
      () => document.querySelector("canvas").getContext("2d").getImageData(235, 440, 1, 1).data[1],
    )) > 70,
    "Circle border must be visibly rendered",
  );
  await page.screenshot({ path: path.join(output, "circle-container.png") });
  const snapshot = await page.evaluate(() => window.doodleQA.snapshot());
  await page.evaluate(() => window.doodleQA.reload());
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), snapshot);
  // Undo/redo crosses real serializer-backed history, including container children.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  assert.deepEqual(await page.evaluate(() => window.doodleQA.snapshot()), snapshot);
  // Releasing a container is an explicit mode change and keeps member geometry.
  await page.mouse.click(740, 70);
  await page.waitForTimeout(150);
  const prior = (await nodes())[1];
  await button("涂鸦模式").click();
  await finishEditing();
  assert.equal((await nodes())[1].parent, undefined);
  assert.equal((await nodes())[1].x, prior.x);
  assert.equal((await nodes())[1].y, prior.y);
  await page.keyboard.press("Control+z");
  assert.equal((await nodes())[1].parent, cage.id);
  // Real bitmap imports inside a fixed container, including automatic image groups.
  for (const wrap of [false, true]) {
    await page.evaluate((wrap) => {
      window.doodleQA.settings.wrapImageInGroup = wrap;
      window.pgClipboard = "image metadata";
      window.pgClipboardImage = {
        width: 80,
        height: 60,
        rgba: Array.from({ length: 80 * 60 }, () => [30, 160, 220, 255]).flat(),
      };
    }, wrap);
    await page.locator("canvas").hover({ position: { x: 1070, y: 620 } });
    await page.keyboard.press("Control+v");
    await page.waitForFunction((length) => window.doodleQA.images().length === length, wrap ? 2 : 1);
    await page.waitForFunction(
      ({ wrap, container }) => {
        const image = window.doodleQA.images().at(-1);
        return wrap ? image?.parent && image.parent !== container : image?.parent === container;
      },
      { wrap, container: cage.id },
    );
    const image = (await page.evaluate(() => window.doodleQA.images())).at(-1);
    contains((await shapes())[1], image);
    if (!wrap) assert.equal(image.parent, cage.id);
    else assert.ok(image.parent && image.parent !== cage.id);
  }
  const beforeLarge = await page.evaluate(() => ({
    count: window.doodleQA.project.stage.length,
    attachments: window.doodleQA.project.attachments.size,
  }));
  await page.evaluate(async () => {
    window.pgClipboardImage = {
      width: 800,
      height: 700,
      rgba: Array.from({ length: 800 * 700 }, () => [10, 20, 30, 255]).flat(),
    };
    await window.doodleQA.project.copyEngine.paste();
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      count: window.doodleQA.project.stage.length,
      attachments: window.doodleQA.project.attachments.size,
    })),
    beforeLarge,
  );
  await page.screenshot({ path: path.join(output, "container-with-images.png") });
  const directImportError = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 500;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const qa = window.doodleQA;
    try {
      await qa.addImage(qa.project, blob, {
        location: qa.project.stageManager.getSections().find((s) => s.isDoodle && s.shape === "rectangle" && s.bounded)
          .frame.center,
        centerAtLocation: true,
        waitForReady: true,
        intrinsicSize: { width: 600, height: 500 },
        wrapInSection: true,
      });
      return "unexpected success";
    } catch (e) {
      return String(e);
    }
  });
  assert.match(directImportError, /放不进/);
  assert.deepEqual(
    await page.evaluate(() => ({
      count: window.doodleQA.project.stage.length,
      attachments: window.doodleQA.project.attachments.size,
    })),
    beforeLarge,
  );
  await page.mouse.click(740, 70);
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => window.pgClipboard.startsWith("ProjectGraphClipboard/1\n"));
  await page.locator("canvas").hover({ position: { x: 700, y: 900 } });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.doodleQA.shapes().length === 4);
  const copied = (await shapes()).at(-1);
  assert.equal(copied.name, "固定知识区");
  assert.notEqual(copied.id, cage.id);
  const copiedNodes = (await nodes()).filter((n) => n.parent === copied.id);
  assert.equal(copiedNodes.length, 1);
  contains(copied, copiedNodes[0]);
  await page.keyboard.press("Control+z");
  assert.equal((await shapes()).length, 3);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "doodles-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "decorative mode",
          "outside click finishes editing without a save button",
          "unchanged finish does not add undo history",
          "eraser finishes editing and hides resize controls",
          "rectangle and circle",
          "new node containment",
          "drag containment",
          "border editing",
          "corner resizing",
          "numeric resizing",
          "oversize rejection",
          "naming",
          "release",
          "undo redo",
          "MsgPack reload",
          "no pen button",
        ],
        shapes: await shapes(),
        nodes: await nodes(),
      },
      null,
      2,
    ),
  );
  console.log("Doodle UI and real PG entity checks passed");
} finally {
  await browser.close();
}

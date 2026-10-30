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
  await page.evaluate(() => window.pg13QA.focus(window.pg13QA.second.id));
  await page.locator("canvas").click({ position: { x: 650, y: 400 } });
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e51b32";
    ctx.fillRect(0, 0, 240, 130);
    ctx.fillStyle = "#ffffff";
    ctx.font = "26px sans-serif";
    ctx.fillText("Snipaste image test", 8, 70);
    window.pgClipboardImage = { width: 320, height: 180, rgba: [...ctx.getImageData(0, 0, 320, 180).data] };
    window.pgClipboard = "Screenshot source metadata";
  });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 1);
  let images = await page.evaluate(() => window.pg13QA.imageSnapshot());
  assert.equal(images.length, 1);
  assert.equal(images[0].width, 320);
  assert.equal(images[0].height, 180);
  assert.deepEqual(images[0].firstPixel, [229, 27, 50, 255]);
  assert.deepEqual(images[0].transparentPixel, [0, 0, 0, 0]);
  assert.ok(images[0].attachmentBytes > 0);
  assert.ok(Math.abs(images[0].center.x - 812.5) < 0.01 && Math.abs(images[0].center.y - 500) < 0.01);
  await page.screenshot({ path: path.join(output, "screenshot-pasted.png") });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 0);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 1);
  images = await page.evaluate(() => window.pg13QA.imageSnapshot());
  assert.deepEqual(images[0].firstPixel, [229, 27, 50, 255]);
  await page.evaluate(() => window.pg13QA.reloadImagesFromMsgpack());
  assert.deepEqual(await page.evaluate(() => window.pg13QA.imageSnapshot()), images);
  await page.locator("canvas").hover({ position: { x: 950, y: 450 } });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 2);
  images = await page.evaluate(() => window.pg13QA.imageSnapshot());
  assert.notEqual(images[0].id, images[1].id);
  assert.ok(Math.abs(images[1].center.x - 1187.5) < 0.01, JSON.stringify(images[1].center));
  assert.deepEqual(await page.evaluate(() => [window.pgImageHandlesOpened, window.pgImageHandlesClosed]), [2, 2]);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#12932b";
    ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    window.pgClipboardImage = undefined;
    window.pgDenyTextRead = true;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: async () => [{ types: ["image/png"], getType: async () => blob }],
        readText: async () => {
          throw new Error("No text format");
        },
      },
    });
  });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 3);
  images = await page.evaluate(() => window.pg13QA.imageSnapshot());
  assert.deepEqual(images[2].firstPixel, [18, 147, 43, 255]);
  assert.equal(images[2].width, 120);
  assert.equal(images[2].height, 80);
  await page.evaluate(async () => {
    window.pgClipboardImage = { width: 320, height: 180, rgba: [255, 0, 0, 255] };
    window.pgClipboard = "Damaged image metadata";
    window.pgDenyTextRead = false;
    await window.pg13QA.second.project.copyEngine.paste();
  });
  assert.equal(await page.evaluate(() => window.pg13QA.second.project.stage.length), 3);
  assert.deepEqual(await page.evaluate(() => [window.pgImageHandlesOpened, window.pgImageHandlesClosed]), [3, 3]);
  await page.evaluate(async () => {
    const files = {};
    for (const [name, color, width, height] of [
      ["C:\\图片\\一.png", "#2255cc", 160, 100],
      ["C:\\图片\\二.jpg", "#eeaa22", 120, 80],
    ]) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, name.endsWith("jpg") ? "image/jpeg" : "image/png"),
      );
      files[name] = [...new Uint8Array(await blob.arrayBuffer())];
    }
    window.pgClipboardImage = undefined;
    window.pgDenyTextRead = true;
    window.pgClipboardFiles = files;
  });
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 5);
  images = await page.evaluate(() => window.pg13QA.imageSnapshot());
  assert.deepEqual(
    images.slice(3).map((image) => [image.width, image.height]),
    [
      [160, 100],
      [120, 80],
    ],
  );
  assert.ok(images[3].center.x < images[4].center.x);
  assert.ok(Math.abs((images[3].center.x - 80 + images[4].center.x + 60) / 2 - 1187.5) < 0.01);
  assert.equal(
    await page.evaluate(() => window.pg13QA.second.project.stage.filter((node) => node.isSelected).length),
    2,
  );
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 3);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => window.pg13QA.second.project.stage.length === 5);
  assert.deepEqual(await page.evaluate(() => window.pg13QA.imageNodeOperations()), {
    moved: { x: 40, y: 25 },
    scaled: true,
    linked: true,
    copiedCorrectly: true,
    deleted: true,
    undone: true,
    redone: true,
  });
  await page.screenshot({ path: path.join(output, "native-and-web-images.png") });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "images-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "image plus text metadata",
          "real RGBA to PNG pixels",
          "alpha preserved",
          "center at cursor",
          "binary attachment",
          "undo",
          "redo",
          "msgpack reconstruction",
          "repeat paste with new ids",
          "native image handles closed",
          "web image fallback after native/text unavailable",
          "damaged image rejected without metadata node or resource leak",
          "Explorer PNG/JPEG file bytes",
          "multiple images centered and selected as nodes",
          "image move, existing Ctrl-wheel handler, link, copy, delete, undo and redo",
          "no browser errors",
        ],
        images,
      },
      null,
      2,
    ),
  );
  console.log("PG image clipboard browser checks passed");
} finally {
  await browser.close();
}

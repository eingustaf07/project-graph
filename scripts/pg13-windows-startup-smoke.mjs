import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

if (process.platform !== "win32") throw new Error("This smoke test targets Windows only");
const executable = process.argv[2] ?? path.resolve("app/src-tauri/target/release/project-graph-pg11.exe");
const reportPath = process.argv[3] ?? path.resolve("app/src-tauri/target/startup-smoke-result.json");
await fs.access(executable);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "pg13-startup-smoke-"));
const reserve = net.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const child = spawn(executable, [], {
  cwd: path.dirname(executable),
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    APPDATA: path.join(profile, "Roaming"),
    WEBVIEW2_USER_DATA_FOLDER: path.join(profile, "WebView"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  },
});
const report = {
  executable,
  pid: child.pid,
  started: new Date().toISOString(),
  passed: false,
  state: null,
  errors: [],
};
let socket;
let spawnError;
child.on("error", (error) => {
  spawnError = error;
});
try {
  if (!child.pid) throw new Error("Windows application process was not created");
  let target;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !target) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Application exited early: ${child.exitCode}`);
    try {
      const pages = await (
        await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
      ).json();
      report.targets = pages.map((page) => ({ type: page.type, url: page.url.split(/[?#]/)[0] }));
      target = pages.find((page) => page.type === "page" && /^https?:\/\/tauri\.localhost(?:\/|$)/.test(page.url));
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    if (!target) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!target) throw new Error("Application WebView did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebView debugger connection timed out")), 5000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      { once: true },
    );
  });
  const pending = new Map();
  let id = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      pending.get(message.id)?.(message.result ?? message.error);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown")
      report.errors.push(
        message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text,
      );
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timeout = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`WebView ${method} timed out`));
      }, 5000);
      pending.set(request, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  await send("Runtime.enable");
  while (Date.now() < deadline) {
    if (report.errors.length) throw new Error("Packaged frontend threw during startup: " + report.errors.join("; "));
    const response = await send("Runtime.evaluate", {
      expression:
        "JSON.stringify({ready:document.readyState,title:document.title,rootElements:document.getElementById('root')?.childElementCount,canvasCount:document.querySelectorAll('canvas').length,toolbar:!!document.querySelector('[aria-label=涂鸦面板]')})",
      returnByValue: true,
    });
    if (response.result?.value) report.state = JSON.parse(response.result.value);
    if (report.state?.rootElements > 0 && report.state?.canvasCount > 0 && report.state?.toolbar) {
      report.passed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!report.passed) throw new Error("Packaged application did not mount its real canvas and drawing toolbar");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (report.errors.length) {
    report.passed = false;
    throw new Error("Startup exception after mount: " + report.errors.join("; "));
  }
  console.log(
    "PASS: packaged Windows application mounted the real canvas and drawing toolbar without startup exceptions",
  );
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  socket?.close();
  if (child.pid && child.exitCode === null)
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  report.finished = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
}

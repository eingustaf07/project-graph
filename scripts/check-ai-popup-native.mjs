import fs from "node:fs/promises";

const deadline = Date.now() + 60000;
let target;
while (!target && Date.now() < deadline) {
  try {
    const pages = await (await fetch("http://127.0.0.1:19515/json/list")).json();
    target = pages.find((page) => page.type === "page" && page.url.startsWith("http://localhost:1420/"));
  } catch (error) {
    if (Date.now() >= deadline) throw error;
  }
  if (!target) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!target) throw Error("Native development window did not expose its diagnostic endpoint");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Native AI popup validation timed out")), 30000);
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      if (message.error || message.result?.exceptionDetails) {
        reject(
          Error(
            message.error?.message ||
              message.result.exceptionDetails.exception?.description ||
              message.result.exceptionDetails.text,
          ),
        );
      } else resolve(message.result.result.value);
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
          expression: `(async () => {
        const assert = (value, message) => { if (!value) throw Error(message); };
        assert(await window.__TAURI_INTERNALS__.invoke('supports_ai_popup'), 'Native AI popup command unavailable');
        const child = window.open('about:blank#pg-ai-popup', 'pg-native-smoke', 'popup,width=560,height=760');
        assert(child, 'Native popup was blocked');
        const panel = document.createElement('div');
        panel.textContent = 'live-panel';
        document.body.append(panel);
        try {
          assert(child.opener === window, 'Native popup does not retain its original opener');
          child.document.body.append(panel);
          assert(child.document.body.contains(panel), 'Live panel cannot be moved to native popup');
          panel.textContent = 'live-panel-updated';
          assert(child.document.body.textContent.includes('live-panel-updated'), 'Live panel updates lost');
          document.body.append(panel);
          assert(panel.ownerDocument === document, 'Panel cannot return to original document');
          return { nativeCommand: true, opener: true, livePanel: true, restore: true };
        } finally { panel.remove(); child.close(); }
      })()`,
        },
      }),
    );
  });
  await fs.writeFile(process.argv[2] || "ai-popup-native.json", JSON.stringify(result, null, 2));
  console.log("Native AI popup validation passed");
} finally {
  socket.close();
}

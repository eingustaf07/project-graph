// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@/core/service/Settings", () => ({
  Settings: { use: (key: string) => [key === "aiConnectionMode" ? "chatgpt" : "model", vi.fn()] },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
import { ChatGPTConnectionSettings } from "./ChatGPTConnectionSettings";
afterEach(() => api.invoke.mockReset());

it("waits for persisted login status instead of offering a fresh login during refresh", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let resolve!: (value: unknown) => void;
  api.invoke.mockImplementation(() => new Promise((done) => (resolve = done)));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<ChatGPTConnectionSettings />));
    expect(host.textContent).toContain("正在读取 ChatGPT 登录状态");
    expect(host.textContent).not.toContain("chatgpt.signIn");
    await act(async () => resolve({ connected: true, hasPlanAccess: false }));
    expect(host.textContent).toContain("chatgpt.disconnect");
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("chatgpt_connection_status");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("provides a status retry for a transient failure without invoking login or disconnect", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.invoke
    .mockRejectedValueOnce(new Error("network temporarily unavailable"))
    .mockResolvedValueOnce({ connected: true, hasPlanAccess: false });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<ChatGPTConnectionSettings />));
    expect(host.textContent).toContain("暂时无法确认连接状态");
    expect(host.textContent).not.toContain("chatgpt.signIn");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "重试读取连接状态")!;
    await act(() => retry.click());
    expect(host.textContent).toContain("chatgpt.disconnect");
    expect(api.invoke.mock.calls.map(([name]) => name)).toEqual([
      "chatgpt_connection_status",
      "chatgpt_connection_status",
    ]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

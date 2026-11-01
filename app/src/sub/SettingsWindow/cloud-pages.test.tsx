// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ fetch: vi.fn(), open: vi.fn(), error: vi.fn(), event: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fixture.fetch }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: fixture.open }));
vi.mock("@/core/service/Telemetry", () => ({ Telemetry: { event: fixture.event } }));
vi.mock("@/state", () => ({ isDevAtom: "dev", currentUserAtom: "user", store: { set: vi.fn() } }));
vi.mock("jotai", () => ({ useAtom: () => [null] }));
vi.mock("sonner", () => ({ toast: { error: fixture.error, success: vi.fn() } }));
vi.mock("@/core/service/AuthClient", () => ({ authClient: { signIn: { email: vi.fn() } } }));
vi.mock("@/core/service/UserState", () => ({ UserState: { setSession: vi.fn() } }));
vi.mock("@/utils/otherApi", () => ({ getAppVersion: vi.fn(), getDeviceId: vi.fn() }));
vi.mock("@/core/extension/ExtensionManager", () => ({
  ExtensionManager: { getExtensions: async () => [], reload: vi.fn() },
}));
vi.mock("@/core/extension/Extension", () => ({}));
vi.mock("@/components/ui/sidebar", () => {
  const Div = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Div,
    SidebarContent: Div,
    SidebarFooter: Div,
    SidebarGroup: Div,
    SidebarGroupContent: Div,
    SidebarMenu: Div,
    SidebarMenuItem: Div,
    SidebarMenuButton: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
      <button onClick={onClick}>{children}</button>
    ),
  };
});
vi.mock("@/components/ui/switch", () => ({ Switch: () => <input type="checkbox" /> }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("LR_API_BASE_URL", undefined);
  fixture.open.mockResolvedValue(undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

async function showCredits() {
  const { default: CreditsTab } = await import("./credits");
  await act(async () => root.render(<CreditsTab />));
}

describe("cloud settings pages without build-time cloud config", () => {
  it("loads and renders the real credits page from the default endpoint", async () => {
    fixture.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ user: "支持者测试", amount: 12, note: "支持开源" }],
    });
    await showCredits();
    expect(fixture.fetch).toHaveBeenCalledWith("https://hub.graphif.dev/api/donations", expect.any(Object));
    expect(container.textContent).toContain("支持者测试");
    expect(container.textContent).toContain("支持开源");
    expect(container.textContent).not.toContain("加载失败");
  });

  it("reports server errors and recovers when Refresh is clicked", async () => {
    fixture.fetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ user: "重试成功", amount: 5 }] });
    await showCredits();
    expect(container.textContent).toContain("HTTP 503");
    const refresh = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("刷新"))!;
    await act(async () => refresh.click());
    expect(container.textContent).toContain("重试成功");
    expect(container.textContent).not.toContain("加载失败");
  });

  it("shows malformed response errors instead of crashing the settings window", async () => {
    fixture.fetch.mockResolvedValue({ ok: true, json: async () => ({ error: "unexpected payload" }) });
    await showCredits();
    expect(container.textContent).toContain("名单格式不正确");
  });

  it("shows network failure with a retry entry", async () => {
    fixture.fetch.mockRejectedValue(new Error("连接超时"));
    await showCredits();
    expect(container.textContent).toContain("连接超时");
    expect(container.textContent).toContain("刷新");
  });

  it("opens the official market from the extension page", async () => {
    const { default: ExtensionsTab } = await import("./extensions");
    await act(async () => root.render(<ExtensionsTab />));
    const market = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("扩展市场"),
    )!;
    await act(async () => market.click());
    expect(fixture.open).toHaveBeenCalledWith("https://hub.graphif.dev/ext/marketplace");
    fixture.open.mockRejectedValueOnce(new Error("浏览器启动失败"));
    await act(async () => market.click());
    expect(fixture.error).toHaveBeenCalledWith("浏览器启动失败");
  });

  it("restores the account login form and registration link", async () => {
    const { default: AccountTab } = await import("./account");
    await act(async () => root.render(<AccountTab />));
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).not.toContain("云服务功能未启用");
    const register = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("前往注册"),
    )!;
    await act(async () => register.click());
    expect(fixture.open).toHaveBeenCalledWith("https://hub.graphif.dev/");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ createAuthClient: vi.fn(() => ({ session: "test-client" })), fetch: vi.fn() }));
vi.mock("better-auth/client", () => ({ createAuthClient: fixture.createAuthClient }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fixture.fetch }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("LR_API_BASE_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("cloud services in custom PG builds", () => {
  it.each([undefined, "", "   "])("uses the official public endpoints with absent config %s", async (value) => {
    vi.stubEnv("LR_API_BASE_URL", value);
    const config = await import("./CloudServiceConfig");
    expect(config.cloudServiceUrl("api/donations")).toBe("https://hub.graphif.dev/api/donations");
    expect(config.cloudServiceUrl("/ext/marketplace")).toBe("https://hub.graphif.dev/ext/marketplace");
    expect(config.cloudServiceUrl()).toBe("https://hub.graphif.dev/");
    const { authClient } = await import("./AuthClient");
    expect(authClient).not.toBeNull();
    expect(fixture.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://hub.graphif.dev/api/auth",
        fetchOptions: { customFetchImpl: fixture.fetch },
      }),
    );
    const { FeatureFlags } = await import("./FeatureFlags");
    expect(FeatureFlags.USER).toBe(true);
    expect(FeatureFlags.TELEMETRY).toBe(false);
    expect(FeatureFlags.AI).toBe(false);
  });

  it("preserves explicitly configured servers and normalizes trailing slashes", async () => {
    vi.stubEnv("LR_API_BASE_URL", " http://localhost:3000/cloud/// ");
    const config = await import("./CloudServiceConfig");
    expect(config.cloudServiceUrl("ext/marketplace")).toBe("http://localhost:3000/cloud/ext/marketplace");
    await import("./AuthClient");
    expect(fixture.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:3000/cloud/api/auth" }),
    );
  });

  it.each([
    "undefined",
    "file:///C:/PG",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
    "https://example.com/#x",
  ])("rejects invalid explicit config without crashing auth initialization: %s", async (value) => {
    vi.stubEnv("LR_API_BASE_URL", value);
    const config = await import("./CloudServiceConfig");
    expect(config.cloudServiceBaseUrl).toBeNull();
    expect(() => config.cloudServiceUrl("ext/marketplace")).toThrow("云服务地址配置无效");
    expect((await import("./AuthClient")).authClient).toBeNull();
    expect((await import("./FeatureFlags")).FeatureFlags.USER).toBe(false);
    expect(fixture.createAuthClient).not.toHaveBeenCalled();
  });
});

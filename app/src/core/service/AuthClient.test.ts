import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fixture.fetch }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("LR_API_BASE_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("real account client transport", () => {
  it("routes the existing email login through Tauri to the official auth endpoint", async () => {
    fixture.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "fixture-only-token",
          user: { id: "fixture-user", email: "test@example.invalid", name: "Test", emailVerified: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { authClient } = await import("./AuthClient");
    const result = await authClient!.signIn.email({ email: "test@example.invalid", password: "fixture-only-password" });
    expect(String(fixture.fetch.mock.calls[0][0])).toBe("https://hub.graphif.dev/api/auth/sign-in/email");
    expect(fixture.fetch.mock.calls[0][1].method).toBe("POST");
    expect(result.data?.user.id).toBe("fixture-user");
    expect(result.error).toBeNull();
  });

  it("surfaces server rejection through the existing login error result", async () => {
    fixture.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "邮箱或密码不正确" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { authClient } = await import("./AuthClient");
    const result = await authClient!.signIn.email({ email: "test@example.invalid", password: "fixture-only-password" });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("邮箱或密码不正确");
  });
});

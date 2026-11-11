import { afterEach, expect, it, vi } from "vitest";
import { compareWindowRuntimes, ensureCurrentDevelopmentRevision, type WindowRuntime } from "./development-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const baseline = (): WindowRuntime => ({
  revision: "source-a",
  commands: [{ id: "copy", key: "C-c", enabled: true }],
  extensions: [{ id: "extension", hash: "code-a" }],
});
it("distinguishes stale source, missing commands and outdated extension code", () => {
  const original = baseline();
  expect(compareWindowRuntimes(original, baseline())).toBeUndefined();
  expect(compareWindowRuntimes(original, { ...baseline(), revision: "source-b" })).toMatch("代码批次");
  expect(compareWindowRuntimes(original, { ...baseline(), commands: [] })).toMatch("功能命令");
  expect(compareWindowRuntimes(original, { ...baseline(), extensions: [{ id: "extension", hash: "code-b" }] })).toMatch(
    "扩展",
  );
});
it("checks the live source revision without trusting a cached response", async () => {
  vi.stubEnv("LR_PG_DEVELOPMENT_SESSION", "1");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: "stale-source" }) });
  vi.stubGlobal("fetch", fetcher);
  await expect(ensureCurrentDevelopmentRevision()).rejects.toThrow("尚未加载最新");
  expect(fetcher).toHaveBeenCalledWith("/__pg_development/status", { cache: "no-store" });
});

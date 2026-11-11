import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { developmentSession, sourceRevision } from "./development-session";
it("fingerprints source changes and sends explicit reload events without permitting stale cached windows", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pg-window-revision-"));
  try {
    fs.mkdirSync(path.join(workspace, "app/src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "app/src/feature.ts"), "export const value = 1");
    const first = sourceRevision(workspace);
    fs.writeFileSync(path.join(workspace, "app/src/feature.test.ts"), "test-only change");
    expect(sourceRevision(workspace)).toBe(first);
    fs.writeFileSync(path.join(workspace, "app/src/feature.ts"), "export const value = 2");
    expect(sourceRevision(workspace)).not.toBe(first);
    vi.stubEnv("LR_PG_DEVELOPMENT_SESSION", "1");
    let middleware: any;
    const send = vi.fn();
    const plugin = developmentSession(workspace);
    (plugin.configureServer as (...args: any[]) => any)({
      middlewares: {
        use: (callback: unknown) => {
          middleware = callback;
        },
      },
      ws: { send },
      moduleGraph: { invalidateAll: vi.fn() },
    });
    const headers = new Map();
    let body = "";
    const response = {
      setHeader: (key: string, value: string) => headers.set(key, value),
      writeHead: vi.fn(),
      end: (text: string) => {
        body = text;
      },
    };
    middleware({ url: "/__pg_development/status", headers: {} }, response, vi.fn());
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.parse(body).revision).toBe(sourceRevision(workspace));
    response.setHeader("Cache-Control", "no-cache");
    (response.writeHead as (...args: any[]) => any)(200, { "Cache-Control": "max-age=3600" });
    expect(headers.get("Cache-Control")).toBe("no-store");
    const html = (plugin.transformIndexHtml as (html: string) => string)(
      '<script type="module" src="/src/main.tsx"></script>',
    );
    expect(html).toContain("pgRevision=");
    middleware({ url: "/__pg_development/apply", method: "POST", headers: {} }, response, vi.fn());
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ restartShell: false }) }),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
});

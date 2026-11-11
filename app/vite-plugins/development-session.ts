import type { Plugin } from "vite";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";

export function sourceRevision(workspace: string): string {
  const hash = createHash("sha256");
  function visit(directory: string) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "dist", "target", ".git", "tests", "__tests__"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(tsx?|jsx?|json|ya?ml|css)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        hash.update(path.relative(workspace, file).replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(fs.readFileSync(file));
        hash.update("\0");
      }
    }
  }
  visit(path.join(workspace, "app/src"));
  visit(path.join(workspace, "app/vite-plugins"));
  visit(path.join(workspace, "packages"));
  for (const file of ["app/vite.config.ts", "app/src-tauri/tauri.conf.json", "pnpm-lock.yaml"])
    if (fs.existsSync(path.join(workspace, file))) hash.update(fs.readFileSync(path.join(workspace, file)));
  return hash.digest("hex");
}

export function developmentSession(workspace: string): Plugin {
  let readyAt = 0;
  let revision: string | undefined;
  const currentRevision = () => (revision ??= sourceRevision(workspace));
  const enabled = process.env.LR_PG_DEVELOPMENT_SESSION === "1";
  return {
    name: "pg-development-session",
    transform(_code, id) {
      if (id.split("?")[0].replaceAll("\\", "/").endsWith("/src/development-revision.ts"))
        return `export const developmentRevision = ${JSON.stringify(currentRevision())};`;
    },
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace('src="/src/main.tsx"', `src="/src/main.tsx?pgRevision=${currentRevision()}"`);
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        if (
          request.url?.startsWith("/__pg_development") ||
          request.url?.includes("/src/") ||
          request.url === "/" ||
          request.url?.startsWith("/index.html")
        ) {
          response.setHeader("Cache-Control", "no-store");
          const originalHead = response.writeHead.bind(response);
          response.writeHead = ((...args: any[]) => {
            response.setHeader("Cache-Control", "no-store");
            for (let i = 1; i < args.length; i++) {
              if (args[i] && typeof args[i] === "object" && !Array.isArray(args[i]))
                args[i] = { ...args[i], "Cache-Control": "no-store" };
            }
            return (originalHead as (...args: any[]) => typeof response)(...args);
          }) as typeof response.writeHead;
        }
        if (
          request.url?.startsWith("/__pg_development") &&
          (request.headers["sec-fetch-site"] === "cross-site" ||
            (request.headers.origin && request.headers.origin !== "http://localhost:1420"))
        ) {
          response.statusCode = 403;
          response.end();
          return;
        }
        if (request.url === "/__pg_development" || request.url === "/__pg_development/status") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ workspace: path.resolve(workspace), readyAt, revision: currentRevision() }));
        } else if (request.url === "/__pg_development/ready" && request.method === "POST") {
          readyAt = Date.now();
          response.end("Development application ready");
        } else if (request.url === "/__pg_development/apply" && request.method === "POST") {
          revision = undefined;
          server.moduleGraph.invalidateAll();
          server.ws.send({
            type: "custom",
            event: "pg:apply-development",
            data: { restartShell: false, revision: currentRevision() },
          });
          response.end("Development update requested");
        } else next();
      });
    },
    // Apply once after checks pass, so a partially edited module cannot interrupt a live project.
    handleHotUpdate() {
      revision = undefined;
      return [];
    },
  };
}

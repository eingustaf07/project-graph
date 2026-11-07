import type { Plugin } from "vite";
import path from "node:path";

export function developmentSession(workspace: string): Plugin {
  let readyAt = 0;
  return {
    name: "pg-development-session",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
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
          response.end(JSON.stringify({ workspace: path.resolve(workspace), readyAt }));
        } else if (request.url === "/__pg_development/ready" && request.method === "POST") {
          readyAt = Date.now();
          response.end("Development application ready");
        } else if (request.url === "/__pg_development/apply" && request.method === "POST") {
          server.moduleGraph.invalidateAll();
          server.ws.send({ type: "custom", event: "pg:apply-development" });
          response.end("Development update requested");
        } else next();
      });
    },
    // Apply once after checks pass, so a partially edited module cannot interrupt a live project.
    handleHotUpdate() {
      return [];
    },
  };
}

/**
 * Dashboard API server.
 * Serves the dashboard UI and provides REST endpoints for:
 * - Problem status (all running problems)
 * - Notebook pool state
 * - Experiment history and results
 * - Agent activity log
 *
 * Runs on port 3000.
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { loadPool, reclaimExpired, bridgeFetch } from "../core/pool";
import { loadProblemState, listProblems } from "../core/problem";

const PORT = 3000;
const STATIC_DIR = path.join(__dirname, "ui");

function serveStatic(
  res: http.ServerResponse,
  filePath: string,
  contentType: string
): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleApi(
  pathname: string,
  res: http.ServerResponse
): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  switch (pathname) {
    case "/api/problems": {
      const problems = listProblems().map((id) => loadProblemState(id));
      res.end(JSON.stringify(problems));
      break;
    }

    case "/api/pool": {
      const reclaimed = reclaimExpired();
      const pool = loadPool();
      res.end(JSON.stringify({ ...pool, reclaimed }));
      break;
    }

    case "/api/bridge": {
      try {
        const status = await bridgeFetch("/status");
        res.end(JSON.stringify({ connected: true, ...status as object }));
      } catch {
        res.end(JSON.stringify({ connected: false }));
      }
      break;
    }

    default: {
      // /api/problems/:id
      const match = pathname.match(/^\/api\/problems\/([^/]+)$/);
      if (match) {
        const state = loadProblemState(match[1]);
        res.end(JSON.stringify(state));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      }
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith("/api/")) {
    await handleApi(pathname, res);
    return;
  }

  // Static UI
  if (pathname === "/" || pathname === "/index.html") {
    serveStatic(res, path.join(STATIC_DIR, "index.html"), "text/html");
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`rlclaw dashboard: http://localhost:${PORT}`);
});

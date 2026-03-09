const vscode = require("vscode");
const http = require("http");
const https = require("https");

let server;

const COLAB_GAPI = "https://colab.pa.googleapis.com";
const COLAB_SCOPES = [
  "profile",
  "email",
  "https://www.googleapis.com/auth/colaboratory",
];

function activate(context) {
  const port =
    vscode.workspace.getConfiguration("rlclaw.bridge").get("port") || 18808;

  server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const result = await handleRequest(url.pathname, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`rlclaw bridge listening on http://127.0.0.1:${port}`);
    vscode.window.showInformationMessage(`rlclaw bridge ready on port ${port}`);
  });

  context.subscriptions.push({ dispose: () => server?.close() });
}

// --- Google OAuth via VS Code's auth API (same session as Colab extension) ---

async function getGoogleToken() {
  const session = await vscode.authentication.getSession(
    "google",
    COLAB_SCOPES,
    { createIfNone: false }
  );
  if (!session) throw new Error("No Google auth session — sign in via Colab extension first");
  return session.accessToken;
}

// --- Colab GAPI helpers ---

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function colabApi(path, method = "GET") {
  const token = await getGoogleToken();
  const url = new URL(path, COLAB_GAPI);
  return httpsRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Colab-Client-Agent": "vscode",
    },
  });
}

// Get all assigned Colab runtimes
async function listAssignments() {
  return colabApi("/v1/assignments");
}

// Get a fresh proxy token for a runtime endpoint
async function getProxyToken(endpointId) {
  const url = `/v1/runtime-proxy-token?endpoint=${encodeURIComponent(endpointId)}&port=8080`;
  return colabApi(url);
}

// Get full connection info for all runtimes (baseUrl + proxy token)
async function getConnections() {
  const assignments = await listAssignments();
  if (!assignments?.assignments?.length) {
    return { connections: [], note: "No Colab runtimes assigned" };
  }

  const connections = [];
  for (const a of assignments.assignments) {
    try {
      const proxy = await getProxyToken(a.id || a.endpoint);
      connections.push({
        id: a.id || a.endpoint,
        label: a.label,
        accelerator: a.accelerator,
        baseUrl: proxy.url,
        token: proxy.token,
        tokenTtl: proxy.tokenTtl,
      });
    } catch (err) {
      connections.push({
        id: a.id || a.endpoint,
        label: a.label,
        error: err.message,
      });
    }
  }
  return { connections };
}

// Execute code on a Colab runtime via its Jupyter REST API
async function executeOnRuntime(baseUrl, proxyToken, code) {
  // First, list kernels to find an active one
  const kernelsUrl = new URL("/api/kernels", baseUrl);
  const kernels = await httpsRequest(kernelsUrl, {
    method: "GET",
    headers: {
      "X-Colab-Runtime-Proxy-Token": proxyToken,
      "X-Colab-Client-Agent": "vscode",
    },
  });

  if (!kernels.length) throw new Error("No active kernels on runtime");

  const kernelId = kernels[0].id;

  // Execute via the Jupyter kernel REST API
  const execUrl = new URL(`/api/kernels/${kernelId}/execute`, baseUrl);
  const result = await httpsRequest(execUrl, {
    method: "POST",
    headers: {
      "X-Colab-Runtime-Proxy-Token": proxyToken,
      "X-Colab-Client-Agent": "vscode",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      allow_stdin: false,
    }),
  });

  return result;
}

async function handleRequest(path, body) {
  switch (path) {
    // --- Colab direct API ---

    // Get Google auth status
    case "/auth": {
      try {
        const token = await getGoogleToken();
        return { ok: true, tokenPrefix: token.slice(0, 10) + "..." };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // List assigned Colab runtimes
    case "/runtimes":
      return listAssignments();

    // Get connections (baseUrl + proxy token) for all runtimes
    case "/connections":
      return getConnections();

    // Get a proxy token for a specific endpoint
    case "/proxy-token": {
      const { endpointId } = JSON.parse(body);
      return getProxyToken(endpointId);
    }

    // Execute code on a runtime
    case "/execute": {
      const { runtimeIndex, code, baseUrl, token } = JSON.parse(body);

      // If baseUrl + token provided, use directly
      if (baseUrl && token) {
        return executeOnRuntime(baseUrl, token, code);
      }

      // Otherwise, resolve from runtimeIndex
      const conns = await getConnections();
      const idx = runtimeIndex || 0;
      const conn = conns.connections[idx];
      if (!conn || conn.error)
        throw new Error(`Runtime ${idx} not available: ${conn?.error || "not found"}`);
      return executeOnRuntime(conn.baseUrl, conn.token, code);
    }

    // --- Legacy VS Code notebook endpoints (kept for compatibility) ---

    case "/status":
      return getStatus();

    case "/status-all":
      return getStatusAll();

    case "/notebooks": {
      return {
        notebooks: vscode.workspace.notebookDocuments.map((nb) => ({
          path: nb.uri.fsPath,
          cellCount: nb.cellCount,
          done: checkAllCellsDone(nb),
          hasErrors: checkHasErrors(nb),
        })),
      };
    }

    case "/read-outputs": {
      const parsed = JSON.parse(body);
      if (!parsed.filePath) throw new Error("filePath required");
      return readNotebookOutputs(parsed.filePath);
    }

    default:
      return {
        error: "unknown endpoint",
        endpoints: [
          "GET /auth — check Google auth status",
          "GET /runtimes — list assigned Colab runtimes",
          "GET /connections — get baseUrl + proxy token for all runtimes",
          "POST /proxy-token {endpointId} — get proxy token for one runtime",
          "POST /execute {code, runtimeIndex?} or {code, baseUrl, token} — execute code on runtime",
          "GET /status — active notebook status",
          "GET /status-all — all notebooks status",
          "GET /notebooks — list open notebooks",
          "POST /read-outputs {filePath} — read notebook cell outputs",
        ],
      };
  }
}

// --- Legacy notebook helpers ---

function findNotebook(filePath) {
  if (!filePath) return null;
  const uri = vscode.Uri.file(filePath);
  return vscode.workspace.notebookDocuments.find(
    (n) => n.uri.fsPath === uri.fsPath
  );
}

function checkAllCellsDone(notebook) {
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    if (cell.kind !== vscode.NotebookCellKind.Code) continue;
    const s = cell.executionSummary;
    if (!s || s.success === undefined) return false;
  }
  return true;
}

function checkHasErrors(notebook) {
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    if (cell.kind !== vscode.NotebookCellKind.Code) continue;
    if (cell.executionSummary?.success === false) return true;
  }
  return false;
}

function collectOutputs(notebook) {
  const outputs = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    if (cell.kind !== vscode.NotebookCellKind.Code) continue;
    const cellOutputs = [];
    for (const output of cell.outputs) {
      for (const item of output.items) {
        const text = Buffer.from(item.data).toString("utf-8");
        cellOutputs.push({ mime: item.mime, text: text.slice(0, 5000) });
      }
    }
    outputs.push({
      cellIndex: i,
      source: cell.document.getText().slice(0, 200),
      success: cell.executionSummary?.success ?? null,
      outputs: cellOutputs,
    });
  }
  return outputs;
}

function describeCells(notebook) {
  const cells = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    cells.push({
      index: i,
      kind: cell.kind === vscode.NotebookCellKind.Code ? "code" : "markup",
      executionSummary: cell.executionSummary
        ? {
            executionOrder: cell.executionSummary.executionOrder,
            success: cell.executionSummary.success,
            timing: cell.executionSummary.timing,
          }
        : null,
      outputCount: cell.outputs.length,
    });
  }
  return cells;
}

async function getStatus() {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return { activeNotebook: null };
  return {
    activeNotebook: editor.notebook.uri.fsPath,
    cellCount: editor.notebook.cellCount,
    cells: describeCells(editor.notebook),
  };
}

async function getStatusAll() {
  const result = {};
  for (const nb of vscode.workspace.notebookDocuments) {
    result[nb.uri.fsPath] = {
      cellCount: nb.cellCount,
      cells: describeCells(nb),
    };
  }
  return result;
}

function readNotebookOutputs(filePath) {
  const nb = findNotebook(filePath);
  if (!nb) throw new Error(`Notebook not open: ${filePath}`);
  return { file: filePath, outputs: collectOutputs(nb) };
}

function deactivate() {
  server?.close();
}

module.exports = { activate, deactivate };

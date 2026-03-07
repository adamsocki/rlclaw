const vscode = require("vscode");
const http = require("http");

let server;

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

  context.subscriptions.push(
    vscode.commands.registerCommand("rlclaw.runNotebook", () =>
      vscode.commands.executeCommand("notebook.execute")
    ),
    vscode.commands.registerCommand("rlclaw.getStatus", () =>
      getStatus().then((s) =>
        vscode.window.showInformationMessage(JSON.stringify(s))
      )
    )
  );
}

function findNotebook(filePath) {
  if (!filePath) return null;
  const uri = vscode.Uri.file(filePath);
  return vscode.workspace.notebookDocuments.find(
    (n) => n.uri.fsPath === uri.fsPath
  );
}

async function ensureOpen(filePath) {
  let nb = findNotebook(filePath);
  if (!nb) {
    nb = await vscode.workspace.openNotebookDocument(
      vscode.Uri.file(filePath)
    );
    await vscode.window.showNotebookDocument(nb);
    await sleep(1000);
  }
  return nb;
}

// Focus a notebook and fire execute — don't await so we can start multiple
async function fireExecute(filePath) {
  const nb = await ensureOpen(filePath);
  await vscode.window.showNotebookDocument(nb);
  await sleep(300);
  // Fire without awaiting — kernel runs independently
  vscode.commands.executeCommand("notebook.execute");
  await sleep(200); // let the command register
  return nb;
}

async function handleRequest(path, body) {
  switch (path) {
    case "/status":
      return getStatus();

    case "/status-all":
      return getStatusAll();

    case "/open": {
      const { filePath } = JSON.parse(body);
      const doc = await vscode.workspace.openNotebookDocument(
        vscode.Uri.file(filePath)
      );
      await vscode.window.showNotebookDocument(doc);
      return { ok: true, file: filePath };
    }

    // Fire-and-forget: start execution, return immediately
    case "/run": {
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.filePath) {
        await fireExecute(parsed.filePath);
        return { ok: true, action: "run_all", file: parsed.filePath };
      }
      await vscode.commands.executeCommand("notebook.execute");
      return { ok: true, action: "run_all", file: "active" };
    }

    // Start multiple notebooks in parallel — fire execute on each sequentially
    // but kernels run independently so they execute concurrently
    case "/run-parallel": {
      const { filePaths } = JSON.parse(body);
      if (!filePaths || !filePaths.length)
        throw new Error("filePaths[] required");

      const results = [];
      for (const fp of filePaths) {
        await fireExecute(fp);
        results.push({ file: fp, started: true });
        // Small delay to let VS Code register the execute command
        await sleep(200);
      }
      return { ok: true, action: "run_parallel", results };
    }

    // Poll completion status for a notebook
    case "/poll": {
      const { filePath } = JSON.parse(body);
      if (!filePath) throw new Error("filePath required");
      const nb = findNotebook(filePath);
      if (!nb) return { done: false, error: "notebook not open" };

      const done = checkAllCellsDone(nb);
      const hasErrors = checkHasErrors(nb);
      return { file: filePath, done, hasErrors };
    }

    // Run and wait for completion
    case "/run-and-wait": {
      const { filePath, timeoutMs } = JSON.parse(body);
      if (!filePath) throw new Error("filePath required");
      const timeout = timeoutMs || 900000;

      await fireExecute(filePath);

      const nb = findNotebook(filePath);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await sleep(3000);
        if (checkAllCellsDone(nb)) {
          return { ok: true, file: filePath, outputs: collectOutputs(nb) };
        }
      }
      return {
        ok: false,
        file: filePath,
        error: "timeout",
        outputs: collectOutputs(nb),
      };
    }

    case "/run-cell": {
      const { filePath, cellIndex } = JSON.parse(body);
      if (filePath) {
        await ensureOpen(filePath);
        const doc = findNotebook(filePath);
        if (doc) await vscode.window.showNotebookDocument(doc);
        await sleep(300);
      }
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) throw new Error("No active notebook");
      editor.selections = [new vscode.NotebookRange(cellIndex, cellIndex + 1)];
      await vscode.commands.executeCommand("notebook.cell.execute");
      return { ok: true, action: "run_cell", cellIndex };
    }

    case "/kernels":
      return getKernels();

    case "/select-kernel": {
      const { kernelLabel } = JSON.parse(body);
      await vscode.commands.executeCommand("notebook.selectKernel");
      return { ok: true, action: "select_kernel", kernelLabel };
    }

    case "/read-outputs": {
      const parsed = JSON.parse(body);
      if (!parsed.filePath) throw new Error("filePath required");
      return readNotebookOutputs(parsed.filePath);
    }

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

    default:
      return {
        error: "unknown endpoint",
        endpoints: [
          "GET /status",
          "GET /status-all",
          "GET /notebooks",
          "POST /open {filePath}",
          "POST /run {filePath?}",
          "POST /run-parallel {filePaths[]}",
          "POST /run-and-wait {filePath, timeoutMs?}",
          "POST /run-cell {filePath?, cellIndex}",
          "POST /poll {filePath}",
          "GET /kernels",
          "POST /select-kernel {kernelLabel}",
          "POST /read-outputs {filePath}",
        ],
      };
  }
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

async function getKernels() {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return { note: "no active notebook" };
  return {
    note: "Kernel info from active notebook",
    notebookUri: editor.notebook.uri.toString(),
  };
}

function readNotebookOutputs(filePath) {
  const nb = findNotebook(filePath);
  if (!nb) throw new Error(`Notebook not open: ${filePath}`);
  return { file: filePath, outputs: collectOutputs(nb) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deactivate() {
  server?.close();
}

module.exports = { activate, deactivate };

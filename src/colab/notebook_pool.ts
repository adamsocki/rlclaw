/**
 * Notebook checkout system for Colab GPU notebooks.
 *
 * 3 notebooks (rlclaw-01, rlclaw-02, rlclaw-03) are shared across agents.
 * Each agent checks out a notebook, runs an experiment (max 15 min), and
 * checks it back in. A polling loop watches for completion and notifies
 * the agent.
 */

import * as fs from "fs";
import * as path from "path";

const POOL_STATE_PATH = path.join(__dirname, "pool_state.json");
const BRIDGE_URL = "http://127.0.0.1:18808";
const MAX_EXPERIMENT_MINUTES = 15;
const POLL_INTERVAL_MS = 10_000; // check every 10s

export interface NotebookSlot {
  id: string; // "01" | "02" | "03"
  path: string;
  status: "available" | "checked_out" | "running" | "completed" | "error";
  checkedOutBy: string | null; // agent name
  experimentName: string | null;
  checkedOutAt: number | null; // timestamp
  deadline: number | null; // must finish by
  result: string | null;
}

export interface PoolState {
  notebooks: NotebookSlot[];
}

function defaultPool(): PoolState {
  return {
    notebooks: ["01", "02", "03"].map((id) => ({
      id,
      path: path.resolve(__dirname, `notebook_${id}.ipynb`),
      status: "available",
      checkedOutBy: null,
      experimentName: null,
      checkedOutAt: null,
      deadline: null,
      result: null,
    })),
  };
}

export function loadPool(): PoolState {
  if (fs.existsSync(POOL_STATE_PATH)) {
    return JSON.parse(fs.readFileSync(POOL_STATE_PATH, "utf-8"));
  }
  const pool = defaultPool();
  savePool(pool);
  return pool;
}

export function savePool(pool: PoolState): void {
  fs.writeFileSync(POOL_STATE_PATH, JSON.stringify(pool, null, 2));
}

/** Check out an available notebook for an agent. Returns null if none free. */
export function checkout(
  agentName: string,
  experimentName: string
): NotebookSlot | null {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.status === "available");
  if (!slot) return null;

  const now = Date.now();
  slot.status = "checked_out";
  slot.checkedOutBy = agentName;
  slot.experimentName = experimentName;
  slot.checkedOutAt = now;
  slot.deadline = now + MAX_EXPERIMENT_MINUTES * 60 * 1000;
  slot.result = null;
  savePool(pool);
  return slot;
}

/** Mark a notebook as running (agent has submitted the job). */
export function markRunning(notebookId: string): void {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.id === notebookId);
  if (slot) {
    slot.status = "running";
    savePool(pool);
  }
}

/** Mark a notebook as completed with results. */
export function markCompleted(notebookId: string, result: string): void {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.id === notebookId);
  if (slot) {
    slot.status = "completed";
    slot.result = result;
    savePool(pool);
  }
}

/** Check a notebook back in, making it available again. */
export function checkin(notebookId: string): void {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.id === notebookId);
  if (slot) {
    slot.status = "available";
    slot.checkedOutBy = null;
    slot.experimentName = null;
    slot.checkedOutAt = null;
    slot.deadline = null;
    slot.result = null;
    savePool(pool);
  }
}

/** Force-reclaim any notebooks past their deadline. */
export function reclaimExpired(): string[] {
  const pool = loadPool();
  const now = Date.now();
  const reclaimed: string[] = [];

  for (const slot of pool.notebooks) {
    if (
      slot.deadline &&
      now > slot.deadline &&
      (slot.status === "checked_out" || slot.status === "running")
    ) {
      reclaimed.push(
        `Notebook ${slot.id} reclaimed from ${slot.checkedOutBy} (experiment: ${slot.experimentName})`
      );
      slot.status = "available";
      slot.checkedOutBy = null;
      slot.experimentName = null;
      slot.checkedOutAt = null;
      slot.deadline = null;
      slot.result = null;
    }
  }

  if (reclaimed.length > 0) savePool(pool);
  return reclaimed;
}

/** Get current pool status as a formatted string (for agent consumption). */
export function poolStatus(): string {
  const pool = loadPool();
  const lines = pool.notebooks.map((n) => {
    const mins = n.deadline
      ? Math.max(0, Math.round((n.deadline - Date.now()) / 60000))
      : 0;
    switch (n.status) {
      case "available":
        return `  [${n.id}] AVAILABLE`;
      case "checked_out":
        return `  [${n.id}] CHECKED OUT by ${n.checkedOutBy} — ${n.experimentName} (${mins}min left)`;
      case "running":
        return `  [${n.id}] RUNNING for ${n.checkedOutBy} — ${n.experimentName} (${mins}min left)`;
      case "completed":
        return `  [${n.id}] COMPLETED for ${n.checkedOutBy} — ${n.experimentName}`;
      case "error":
        return `  [${n.id}] ERROR for ${n.checkedOutBy} — ${n.experimentName}`;
    }
  });
  return `Notebook Pool:\n${lines.join("\n")}`;
}

// --- Bridge integration ---

async function bridgeFetch(
  endpoint: string,
  body?: object
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BRIDGE_URL}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await resp.json()) as Record<string, unknown>;
}

/** Run a notebook via the VS Code bridge and poll until done or timeout. */
export async function runAndWait(
  notebookId: string
): Promise<{ success: boolean; outputs: unknown }> {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.id === notebookId);
  if (!slot) throw new Error(`Unknown notebook: ${notebookId}`);

  // Trigger run
  await bridgeFetch("/run", { filePath: slot.path });
  markRunning(notebookId);

  // Poll for completion
  const deadline = slot.deadline || Date.now() + MAX_EXPERIMENT_MINUTES * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const status = (await bridgeFetch("/status")) as {
      cells?: Array<{
        executionSummary?: { success?: boolean };
        outputCount?: number;
      }>;
    };

    if (!status.cells) continue;

    // Check if all code cells have executed
    const codeCells = status.cells.filter(
      (c: any) => c.kind === "code"
    );
    const allDone = codeCells.every(
      (c: any) => c.executionSummary && c.executionSummary.success !== undefined
    );

    if (allDone) {
      const outputs = await bridgeFetch("/read-outputs", {
        filePath: slot.path,
      });

      const anyFailed = codeCells.some(
        (c: any) => c.executionSummary?.success === false
      );

      if (anyFailed) {
        markCompleted(notebookId, "ERROR: Some cells failed");
        return { success: false, outputs };
      }

      markCompleted(notebookId, "SUCCESS");
      return { success: true, outputs };
    }
  }

  // Timed out
  markCompleted(notebookId, `TIMEOUT after ${MAX_EXPERIMENT_MINUTES}min`);
  return { success: false, outputs: "Experiment exceeded 15 minute limit" };
}

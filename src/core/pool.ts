/**
 * Shared notebook pool — manages Colab GPU notebooks across all problems.
 */

import * as fs from "fs";
import * as path from "path";

const BRIDGE_URL = "http://127.0.0.1:18808";
const POOL_STATE_PATH = path.join(__dirname, "..", "colab", "pool_state.json");
const MAX_EXPERIMENT_MINUTES = 15;

export interface NotebookSlot {
  id: string;
  path: string;
  status: "available" | "checked_out" | "running" | "completed" | "error";
  checkedOutBy: string | null; // "problem:agent"
  experimentName: string | null;
  checkedOutAt: number | null;
  deadline: number | null;
  result: string | null;
}

export interface PoolState {
  notebooks: NotebookSlot[];
}

export function loadPool(): PoolState {
  return JSON.parse(fs.readFileSync(POOL_STATE_PATH, "utf-8"));
}

export function savePool(pool: PoolState): void {
  fs.writeFileSync(POOL_STATE_PATH, JSON.stringify(pool, null, 2));
}

export function checkout(
  problemId: string,
  agentName: string,
  experimentName: string
): NotebookSlot | null {
  const pool = loadPool();
  const slot = pool.notebooks.find((n) => n.status === "available");
  if (!slot) return null;

  const now = Date.now();
  slot.status = "checked_out";
  slot.checkedOutBy = `${problemId}:${agentName}`;
  slot.experimentName = experimentName;
  slot.checkedOutAt = now;
  slot.deadline = now + MAX_EXPERIMENT_MINUTES * 60 * 1000;
  slot.result = null;
  savePool(pool);
  return slot;
}

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
      reclaimed.push(`[${slot.id}] reclaimed from ${slot.checkedOutBy}`);
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

export async function bridgeFetch(
  endpoint: string,
  body?: object
): Promise<unknown> {
  const resp = await fetch(`${BRIDGE_URL}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

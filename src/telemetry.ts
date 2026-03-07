import * as fs from "fs";
import * as path from "path";

const TELEMETRY_PATH = path.join(__dirname, "..", "src", "telemetry.json");

export interface TelemetryData {
  sessionStart: string;
  turns: number;
  workerCalls: number;
  lastActivity: string;
  status: "running" | "idle" | "error" | "complete";
  currentTask: string;
  bestScore: number | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costEstimate: number; // USD
  log: Array<{ time: string; msg: string }>;
}

const PRICING = {
  // Opus per-million-token pricing
  input: 15.0,
  output: 75.0,
  cacheRead: 1.5,
  cacheWrite: 18.75,
};

function defaultTelemetry(): TelemetryData {
  return {
    sessionStart: new Date().toISOString(),
    turns: 0,
    workerCalls: 0,
    lastActivity: new Date().toISOString(),
    status: "idle",
    currentTask: "",
    bestScore: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costEstimate: 0,
    log: [],
  };
}

let telem: TelemetryData = defaultTelemetry();

export function initTelemetry(): void {
  telem = defaultTelemetry();
  telem.status = "running";
  save();
}

export function recordTurn(msg: any): void {
  telem.turns++;
  telem.lastActivity = new Date().toISOString();

  // Extract usage from SDK messages
  if (msg?.usage) {
    const u = msg.usage;
    telem.usage.inputTokens += u.input_tokens || 0;
    telem.usage.outputTokens += u.output_tokens || 0;
    telem.usage.cacheReadTokens += u.cache_read_input_tokens || 0;
    telem.usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
  }

  // Recalculate cost
  telem.costEstimate =
    (telem.usage.inputTokens / 1e6) * PRICING.input +
    (telem.usage.outputTokens / 1e6) * PRICING.output +
    (telem.usage.cacheReadTokens / 1e6) * PRICING.cacheRead +
    (telem.usage.cacheWriteTokens / 1e6) * PRICING.cacheWrite;

  save();
}

export function recordWorkerCall(task: string): void {
  telem.workerCalls++;
  telem.currentTask = task.slice(0, 200);
  telem.lastActivity = new Date().toISOString();
  save();
}

export function recordLog(msg: string): void {
  telem.log.push({ time: new Date().toISOString(), msg: msg.slice(0, 500) });
  // Keep last 50 entries
  if (telem.log.length > 50) telem.log = telem.log.slice(-50);
  telem.lastActivity = new Date().toISOString();
  save();
}

export function recordBestScore(score: number): void {
  if (telem.bestScore === null || score < telem.bestScore) {
    telem.bestScore = score;
  }
  save();
}

export function setStatus(status: TelemetryData["status"]): void {
  telem.status = status;
  save();
}

export function getTelemetry(): TelemetryData {
  return telem;
}

function save(): void {
  try {
    fs.writeFileSync(TELEMETRY_PATH, JSON.stringify(telem, null, 2));
  } catch {
    // non-fatal
  }
}

export function loadTelemetry(): TelemetryData | null {
  try {
    if (fs.existsSync(TELEMETRY_PATH)) {
      return JSON.parse(fs.readFileSync(TELEMETRY_PATH, "utf-8"));
    }
  } catch {}
  return null;
}

/**
 * Problem definition — each research problem is fully isolated.
 * Has its own agents, workspace, results, and experiment history.
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

export interface ProblemConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  agents: Record<string, AgentDefinition>;
  workDir: string; // absolute path to problem workspace
  maxTurns?: number;
}

export interface ExperimentRecord {
  id: string;
  problem: string;
  agent: string;
  name: string;
  notebook: string | null;
  startedAt: string;
  completedAt: string | null;
  duration: number | null; // seconds
  status: "running" | "completed" | "failed" | "timeout";
  metrics: Record<string, number>;
  notes: string;
}

export interface ProblemState {
  id: string;
  status: "idle" | "running" | "paused";
  startedAt: string | null;
  experiments: ExperimentRecord[];
  bestScore: number | null;
  bestExperiment: string | null;
}

const PROBLEMS_DIR = path.join(__dirname, "..", "problems");
const STATE_DIR = path.join(__dirname, "..", "state");

export function loadProblemState(problemId: string): ProblemState {
  const statePath = path.join(STATE_DIR, `${problemId}.json`);
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  }
  return {
    id: problemId,
    status: "idle",
    startedAt: null,
    experiments: [],
    bestScore: null,
    bestExperiment: null,
  };
}

export function saveProblemState(state: ProblemState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const statePath = path.join(STATE_DIR, `${state.id}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function recordExperiment(
  problemId: string,
  experiment: ExperimentRecord
): void {
  const state = loadProblemState(problemId);
  state.experiments.push(experiment);

  // Update best score if this experiment has a total_cost metric
  const totalCost = experiment.metrics?.total_cost;
  if (
    totalCost !== undefined &&
    experiment.status === "completed" &&
    (state.bestScore === null || totalCost < state.bestScore)
  ) {
    state.bestScore = totalCost;
    state.bestExperiment = experiment.id;
  }

  saveProblemState(state);
}

export function listProblems(): string[] {
  if (!fs.existsSync(PROBLEMS_DIR)) return [];
  return fs
    .readdirSync(PROBLEMS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

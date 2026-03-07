# rlclaw — Comma Controls Challenge Research

## What This Is

An agent-orchestrated research system for the [comma.ai Controls Challenge](https://github.com/commaai/controls_challenge).
One main Claude Code agent delegates to 5 specialist subagents. GPU experiments run on Colab Pro+ via a VS Code bridge.

## Goal

Find **compute-efficient** methods to minimize `total_cost = (lataccel_cost * 50) + jerk_cost`
for lateral car steering control. Beat PID (~107), approach SOTA (43.776).

## Architecture

```
Main Agent (orchestrator, src/index.ts)
  ├── arch-search      → controller architectures (<100K params)
  ├── reward-optimizer → loss functions, noise annealing, training objectives
  ├── data-engineer    → data generation, pipelines, DAgger
  ├── evaluator        → benchmarks, result tracking, reports
  └── colab-manager    → GPU notebook pool management
```

## Project Structure

```
src/
  index.ts              — main orchestrator
  agents/definitions.ts — subagent prompts and config
  controllers/          — our controller implementations (Python)
  algos/                — training scripts and configs
  eval/results.json     — experiment result tracker
  colab/
    notebook_01-03.ipynb — 3 Colab GPU notebooks (pool)
    pool_state.json      — notebook checkout state
    notebook_pool.ts     — pool management logic
vendor/
  commaai/              — original challenge (tinyphysics.py, PID baseline, data/)
  tfpgh/                — SOTA solution (score 43.776)
```

## Notebook Pool System

3 Colab notebooks shared across agents. Each experiment capped at **15 minutes**.

- Pool state: `src/colab/pool_state.json`
- Bridge API: `http://127.0.0.1:18808` (VS Code extension)
- Endpoints: `/run`, `/read-outputs`, `/status`, `/run-cell`, `/open`

Workflow: check pool → write experiment into notebook → POST /run → poll /read-outputs → release notebook

## Running

```bash
npm start                              # default research program
npx tsx src/index.ts --prompt="..."    # custom prompt
```

## Key Files

- `vendor/commaai/tinyphysics.py` — the car simulator
- `vendor/commaai/controllers/pid.py` — PID baseline
- `vendor/tfpgh/controllers/bc.py` — behavioral cloning controller (SOTA)
- `vendor/tfpgh/offline/config.py` — training configs
- `src/eval/results.json` — all experiment results

## Evaluation

```bash
# Quick local eval (CPU, ~1 min)
cd vendor/commaai && python tinyphysics.py --model_path ./models/tinyphysics.onnx --data_path ./data --num_segs 100 --controller pid

# Compare controllers
cd vendor/commaai && python eval.py --model_path ./models/tinyphysics.onnx --data_path ./data --num_segs 100 --test_controller <name> --baseline_controller pid
```

## Constraints

- Max 15 min per Colab experiment
- 3 notebooks available concurrently
- Controllers must run at 10Hz+ (real-time)
- Target: <100K parameters for efficiency

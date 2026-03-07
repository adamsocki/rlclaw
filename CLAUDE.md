# rlclaw — Comma Controls Challenge Research

## What This Is

An agent-orchestrated research system for the [comma.ai Controls Challenge](https://github.com/commaai/controls_challenge).
One main Claude Code agent delegates to 5 specialist subagents. GPU experiments run locally on an RTX 5070 Ti (16GB VRAM).

## Goal

Find **compute-efficient** methods to minimize `total_cost = (lataccel_cost * 50) + jerk_cost`
for lateral car steering control. Beat PID (~85 on 100 segs), approach SOTA (43.776).

## Architecture

```
Main Agent (orchestrator, src/index.ts)
  ├── arch-search      → controller architectures (<100K params)
  ├── reward-optimizer → loss functions, noise annealing, training objectives
  ├── data-engineer    → data generation, pipelines, DAgger
  ├── evaluator        → benchmarks, result tracking, reports
  └── gpu-manager      → local GPU experiment management
```

## Project Structure

```
src/
  index.ts              — main orchestrator
  agents/definitions.ts — subagent prompts and config
  controllers/          — our controller implementations (Python)
  algos/                — training scripts and configs
  checkpoints/          — saved model checkpoints
  eval/results.json     — experiment result tracker
vendor/
  commaai/              — original challenge (tinyphysics.py, PID baseline, data/)
  tfpgh/                — SOTA solution (score 43.776)
```

## GPU Setup

Local RTX 5070 Ti (16GB VRAM) shared across all agents. Run experiments directly as python scripts.

Each experiment capped at **15 minutes** for fast iteration.

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
# Quick local eval (~7s, 100 segments)
cd vendor/commaai && python3 tinyphysics.py --model_path ./models/tinyphysics.onnx --data_path ./data --num_segs 100 --controller pid

# Compare controllers
cd vendor/commaai && python3 eval.py --model_path ./models/tinyphysics.onnx --data_path ./data --num_segs 100 --test_controller <name> --baseline_controller pid
```

## Constraints

- Max 15 min per experiment
- 16GB VRAM shared across concurrent experiments
- Controllers must run at 10Hz+ (real-time)
- Target: <100K parameters for efficiency

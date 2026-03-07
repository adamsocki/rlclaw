# rlclaw

A general-purpose agent environment for reinforcement learning research. Claude Code agents get compute, tools, and autonomy to run experiments, iterate on ideas, and report novel findings.

## How It Works

You define a **research problem**. rlclaw spins up a team of specialist Claude Code agents that autonomously:

- Study reference implementations and papers
- Design and implement approaches
- Run GPU experiments on Colab Pro+ (15 min max each)
- Evaluate results, track metrics, iterate
- Report back with findings

Each problem is fully isolated — its own agents, notebooks, results, and workspace. Multiple problems can run concurrently.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard (:3000)                 │
│  Problem status • Notebook pool • Experiment logs   │
│  Results comparison • Agent activity • GPU usage    │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │Problem 1│   │Problem 2│   │Problem 3│
   │ comma   │   │ (next)  │   │  ...    │
   └────┬────┘   └────┬────┘   └────┬────┘
        │              │              │
   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
   │  Agent  │   │  Agent  │   │  Agent  │
   │  Team   │   │  Team   │   │  Team   │
   └────┬────┘   └────┬────┘   └────┬────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
              ┌─────────────────┐
              │  Notebook Pool  │
              │ 01 │ 02 │ 03   │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │  VS Code Bridge │
              │   (:18808)      │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │  Colab Pro+     │
              │  T4 / A100 GPU  │
              └─────────────────┘
```

### Agent Teams

Each problem gets its own orchestrator and specialist agents. For the comma controls challenge:

| Agent | Role |
|---|---|
| **orchestrator** | Breaks down the problem, delegates, tracks progress |
| **arch-search** | Explores controller architectures |
| **reward-optimizer** | Designs loss functions and training objectives |
| **data-engineer** | Builds data pipelines and generates training data |
| **evaluator** | Runs benchmarks, tracks results |
| **colab-manager** | Manages GPU notebook checkout and execution |

### Notebook Pool

3 Colab Pro+ GPU notebooks shared across all problems. Managed by a checkout system:

1. Agent requests a notebook from the pool
2. Pool assigns an available notebook, sets a 15-minute deadline
3. Agent writes experiment code into the notebook
4. VS Code bridge triggers execution on the Colab GPU runtime
5. Agent polls for results, collects outputs
6. Notebook is released back to the pool

Hard limit: **15 minutes per experiment**. Forces fast iteration. Long training gets broken into checkpointed stages.

### VS Code Bridge

A lightweight VS Code extension (`rlclaw-bridge`) that exposes notebook control over HTTP:

```
POST /run           — execute all cells in a notebook
POST /run-cell      — execute a specific cell
POST /read-outputs  — read cell outputs
GET  /status        — get active notebook info
POST /open          — open a notebook in VS Code
```

The bridge connects to Colab GPU runtimes via the [Google Colab VS Code extension](https://marketplace.visualstudio.com/items?itemName=google.colab). No API keys, no browser automation — just HTTP calls to your local VS Code.

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+ with Jupyter (`pip install jupyter nbclient`)
- [VS Code](https://code.visualstudio.com/) with:
  - [Google Colab extension](https://marketplace.visualstudio.com/items?itemName=google.colab)
  - [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
- [Claude Code](https://claude.ai/claude-code) with Max subscription
- Colab Pro+ subscription ($49.99/mo for GPU access)

### Install

```bash
git clone https://github.com/your-org/rlclaw.git
cd rlclaw
npm install
```

### Connect Colab Notebooks

1. Open each notebook (`src/colab/notebook_01.ipynb` through `03`) in VS Code
2. Click **Select Kernel → Colab → Auto Connect**
3. The bridge extension starts automatically on port 18808

### Verify

```bash
# Check bridge is running
curl http://127.0.0.1:18808/status

# Run a test notebook on Colab GPU
curl -X POST http://127.0.0.1:18808/run \
  -H "Content-Type: application/json" \
  -d '{"filePath": "src/colab/notebook_01.ipynb"}'
```

## Usage

### Run a research problem

```bash
# Start the comma controls challenge
npm start

# Custom research prompt
npx tsx src/index.ts --prompt="Explore whether a tiny transformer (< 50K params) can beat PID for lateral control"
```

### Adding a new problem

Create a new problem directory under `src/problems/`:

```
src/problems/my-problem/
  index.ts          — orchestrator with problem-specific system prompt
  agents.ts         — specialist agent definitions
  eval/             — evaluation code and results
  controllers/      — implementations
```

Each problem is self-contained. The orchestrator imports from shared infra (notebook pool, bridge client) but has its own agents, prompts, and workspace.

## Current Problems

### 1. comma Controls Challenge

**Goal:** Minimize `total_cost = (lataccel_cost × 50) + jerk_cost` for lateral car steering control.

| Benchmark | Score | Notes |
|---|---|---|
| PID baseline | ~73 | Simple proportional-integral-derivative |
| SOTA (tfpgh) | 43.776 | CMA-ES → GPU trajectory optimization → behavioral cloning |
| Our target | < 60 | Compute-efficient, trainable in 15 min on a single GPU |

Reference code in `vendor/commaai/` and `vendor/tfpgh/`.

## Project Structure

```
rlclaw/
├── src/
│   ├── index.ts                — main entry point
│   ├── agents/
│   │   └── definitions.ts      — agent team definitions
│   ├── controllers/            — controller implementations
│   ├── algos/                  — training scripts and configs
│   ├── eval/
│   │   └── results.json        — experiment result tracker
│   ├── colab/
│   │   ├── notebook_01-03.ipynb — GPU notebook pool
│   │   ├── pool_state.json     — checkout state
│   │   └── notebook_pool.ts    — pool management
│   └── vscode-ext/
│       ├── extension.js        — VS Code bridge extension
│       └── package.json
├── vendor/
│   ├── commaai/                — controls challenge + dataset
│   └── tfpgh/                  — SOTA reference solution
├── CLAUDE.md                   — agent instructions
├── package.json
└── tsconfig.json
```

## How It's Built

- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — spawns Claude Code agents with tool access. Authenticated via Max subscription, no API key needed.
- **VS Code + Colab extension** — provides GPU runtimes. The rlclaw-bridge extension exposes control over HTTP.
- **Notebook pool** — JSON-based checkout system with 15-min deadlines and automatic reclamation.

The agents have full access to `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, and can spawn sub-agents via `Agent`. They operate on the local filesystem, run Python scripts, and trigger GPU experiments through the bridge.

## License

MIT

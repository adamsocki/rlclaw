# TODO

## Agent file management

The agent writes all its work to `workspace/` (gitignored). Currently there's no good way to review what it did over time.

### What exists
- **Workspace tarball backups** every 30 min via cron (`backups/workspace_*.tar.gz`), 48 retained (24h rolling window)
- **Session logs** (`workspace/sessions/*.jsonl`) — truncated text of orchestrator output, 10 archived sessions
- **Telemetry snapshots** (`backups/telemetry_*.json`) — cost/usage stats every 30 min

### What's missing
- **No git history of workspace/** — it's gitignored so there's no diff-level view of changes. Can't see "the agent changed line 42 of mpc_multipass.py at 3am"
- **No file-level changelog** — session log captures what the agent *said*, not what it actually wrote. Tool calls (reads/writes/edits) aren't logged
- **Backups are opaque tarballs** — to see what changed between two points you'd extract two tarballs and diff manually. No tooling for this
- **Session logs are thin** — just `content.slice(0, 2000)` of text output. The actual Bash commands, file edits, and their results are lost

### Ideas
- [ ] Git-commit workspace/ periodically (separate repo or branch) so you get real version history with diffs
- [ ] Log tool calls (file writes, bash commands) to a structured log alongside the session JSONL
- [ ] Build a CLI to diff workspace between two backup timestamps (`rlclaw diff 2026-03-10T06 2026-03-10T12`)
- [ ] Tag backups with the current best score so you can find "the backup right before/after the score improved"
- [ ] Store the full Claude Code conversation transcript, not just truncated orchestrator text

## Controls challenge

- [ ] Fix the hash mismatch in `workspace/controllers/lookup_combined.py` — the controller computes hashes differently than `rebuild_verified.py`, so the runtime controller can't reproduce the 13.89 score
- [ ] Submit to the official leaderboard (full dataset eval, not just 100 segments)
- [ ] Explore PPO — shows up twice in leaderboard top 5, would give a generalizable policy instead of a lookup table
- [ ] Study haraschax's approach (#1, 35.97) — "MPC + much compute" suggests a similar strategy to ours
- [ ] Try distilling the precomputed action sequences into a small neural net (like tfpgh's BC step) for a submittable controller

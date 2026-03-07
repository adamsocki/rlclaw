#!/bin/bash
# Periodic backup of workspace and telemetry
# Run via cron every 30 minutes

PROJ="/home/jacob/rlclaw"
BACKUP_DIR="$PROJ/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup workspace (controllers, algos, checkpoints, results)
tar czf "$BACKUP_DIR/workspace_${TIMESTAMP}.tar.gz" \
  -C "$PROJ" workspace/ \
  --exclude='workspace/checkpoints/*.pt' \
  --exclude='workspace/checkpoints/*.onnx' \
  2>/dev/null

# Backup telemetry separately (small, always want this)
cp "$PROJ/src/telemetry.json" "$BACKUP_DIR/telemetry_${TIMESTAMP}.json" 2>/dev/null

# Keep only last 48 backups (24 hours at 30 min intervals)
ls -t "$BACKUP_DIR"/workspace_*.tar.gz 2>/dev/null | tail -n +49 | xargs rm -f 2>/dev/null
ls -t "$BACKUP_DIR"/telemetry_*.json 2>/dev/null | tail -n +49 | xargs rm -f 2>/dev/null

echo "[$(date)] Backup complete: workspace_${TIMESTAMP}.tar.gz"

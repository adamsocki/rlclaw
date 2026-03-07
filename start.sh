#!/bin/bash
# Start all rlclaw services
# Usage: ./start.sh [--no-agent]  (skip agent if you want to start it manually)

PROJ="/home/jacob/rlclaw"
cd "$PROJ"

# Kill existing processes
pkill -f "tsx src/discord-bot" 2>/dev/null
pkill -f "tsx src/dashboard" 2>/dev/null
if [ "$1" != "--no-agent" ]; then
  pkill -f "tsx src/index" 2>/dev/null
fi
sleep 2

# Dashboard
nohup npx tsx src/dashboard/server.ts > /tmp/rlclaw-dashboard.log 2>&1 &
echo "Dashboard PID: $! (http://localhost:3000)"

# Discord bot
nohup npx tsx src/discord-bot.ts > /tmp/rlclaw-bot.log 2>&1 &
echo "Bot PID: $!"

# Agent (unless --no-agent)
if [ "$1" != "--no-agent" ]; then
  sleep 2
  CLAUDECODE="" nohup npx tsx src/index.ts > /tmp/rlclaw-session.log 2>&1 &
  echo "Agent PID: $!"
fi

echo ""
echo "Logs:"
echo "  Agent:     tail -f /tmp/rlclaw-session.log"
echo "  Bot:       tail -f /tmp/rlclaw-bot.log"
echo "  Dashboard: tail -f /tmp/rlclaw-dashboard.log"
echo "  Backups:   every 30 min to $PROJ/backups/"

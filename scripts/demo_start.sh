#!/usr/bin/env bash
# One-command demo kickoff.
#   1. Kills any backend on :5001
#   2. Starts backend in STUB mode (deterministic, no LLM, instant results)
#   3. Launches a pre-loaded n=50 sim on Villa Le Blanc
#   4. Prints the link to open in the browser
#
# Usage: bash scripts/demo_start.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Demo kickoff ==="

# 1. Kill any backend on :5001 (Windows / bash-compatible)
PID=$(netstat -ano 2>/dev/null | grep ":5001 " | awk '{print $5}' | head -1)
if [ -n "$PID" ]; then
  echo "killing backend pid=$PID"
  taskkill //F //PID "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
  sleep 1
fi

# 2. Start backend with stub provider
echo "starting backend (stub mode)…"
cd backend
nohup node server_stub.js > /tmp/demo_backend.log 2>&1 &
disown
cd ..

# Wait for port to open
for i in $(seq 1 20); do
  sleep 0.5
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/api/properties 2>/dev/null | grep -q 200; then
    echo "backend listening on :5001"
    break
  fi
done

# 3. Launch n=50 sim
echo "launching n=50 sim on Villa Le Blanc…"
REQ=$(cat scripts/villa_le_blanc_sim_request.json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf-8'));d.agent_count=50;process.stdout.write(JSON.stringify(d))")
RESP=$(curl -s -X POST http://localhost:5001/api/stay-simulate-direct -H "Content-Type: application/json" -d "$REQ")
SIM_ID=$(echo "$RESP" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf-8')).simulationId)")

# Wait for sim to complete (stub runs in <5s)
echo "waiting for sim to finish…"
for i in $(seq 1 30); do
  sleep 1
  STATUS=$(curl -s "http://localhost:5001/api/stay-simulation/$SIM_ID" | node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf-8')).status||'?')}catch{process.stdout.write('?')}")
  if [ "$STATUS" = "completed" ]; then break; fi
done

# 4. Print summary
echo ""
echo "=========================================="
echo "READY for demo"
echo "=========================================="
curl -s "http://localhost:5001/api/stay-simulation/$SIM_ID" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf-8'));
if (d.status !== 'completed') { console.log('status:', d.status, '| phase:', d.progress?.phase); process.exit(0); }
const s = d.result.summary;
console.log('status:    ' + d.status);
console.log('avg stars: ' + s.avg_stars + '★');
console.log('NPS:       ' + s.net_promoter_score);
console.log('dist:      ' + JSON.stringify(s.realized_star_distribution_pct));
console.log('match:     ' + s.target_star_match_rate_pct + '%');
console.log('spend:     €' + s.avg_spend_eur);
console.log('events:    ' + s.adversarial_events_total + '/' + s.total_stays);
"
echo ""
echo "Frontend:  http://localhost:5002/stays/$SIM_ID"
echo "Backend:   http://localhost:5001"
echo "Sim ID:    $SIM_ID"
echo ""
echo "=========================================="

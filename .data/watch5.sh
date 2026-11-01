#!/usr/bin/env bash
KEY=/c/Users/user/.ssh/id_ed25519
H=chai@192.168.8.103
for i in $(seq 1 40); do
  SZ=$(ssh -p 6688 -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$H" 'wc -c < /home/chai/audit/report-round4.md' 2>/dev/null | tr -cd '0-9')
  PR=$(ssh -p 6688 -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$H" 'pgrep -fc "claude -p " || true' 2>/dev/null | tr -cd '0-9')
  [ -z "$SZ" ] && SZ=0
  [ -z "$PR" ] && PR=0
  echo "[$(date +%H:%M:%S)] report=${SZ}B claude=${PR}"
  if [ "$SZ" -gt 2000 ]; then
    echo "DONE ${SZ}"
    exit 0
  fi
  if [ "$PR" -eq 0 ]; then
    echo "ENDED report=${SZ}"
    exit 0
  fi
  sleep 60
done
echo TIMEOUT

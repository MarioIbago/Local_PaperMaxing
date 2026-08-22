#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[PaperMaxing] Node.js 22+ is required. Install it from https://nodejs.org/."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[PaperMaxing] First run: installing local dependencies..."
  npm install
fi

echo "[PaperMaxing] Starting local UI + local API..."
echo "[PaperMaxing] Open http://127.0.0.1:5173"
npm run dev

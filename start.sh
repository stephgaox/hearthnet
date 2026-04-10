#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
AI_ENABLED=true
HAS_NODE=false
HAS_PYTHON=false

# ── Helper: styled output ─────────────────────────────────────────────────────
info()  { echo "▶ $*"; }
warn()  { echo "⚠️  $*"; }
ok()    { echo "✅ $*"; }
fail()  { echo "❌ $*"; }

# ── Cleanup helper (defined early so trap can reference it) ───────────────────
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
  [ -n "$BACKEND_PID" ]  && kill "$BACKEND_PID"  2>/dev/null
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  echo "Stopped."
}
trap cleanup EXIT INT TERM

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Detect & offer to install prerequisites
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo "────────────────────────────────────────────"
echo "  HearthNet — Checking prerequisites..."
echo "────────────────────────────────────────────"
echo ""

# ── 1a. Check Node.js ─────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  HAS_NODE=true
  ok "Node.js found: $(node --version)"
else
  warn "Node.js is not installed (required for the frontend)."
  echo ""
  if command -v brew &>/dev/null; then
    read -rp "   Install Node.js via Homebrew? [y/N] " yn
    if [[ "$yn" =~ ^[Yy]$ ]]; then
      info "Installing Node.js..."
      brew install node
      HAS_NODE=true
      ok "Node.js installed: $(node --version)"
    fi
  else
    echo "   Please install Node.js (v18+) from one of these options:"
    echo "     • https://nodejs.org/  (recommended for beginners)"
    echo "     • brew install node    (if you install Homebrew first: https://brew.sh)"
    echo "     • nvm: https://github.com/nvm-sh/nvm"
    echo ""
  fi
fi

# ── 1b. Check Python 3 ───────────────────────────────────────────────────────
if command -v python3 &>/dev/null || command -v python &>/dev/null; then
  HAS_PYTHON=true
  if command -v python3 &>/dev/null; then
    ok "Python found: $(python3 --version)"
  else
    ok "Python found: $(python --version)"
  fi
else
  warn "Python 3 is not installed (required for the backend)."
  echo ""
  if command -v brew &>/dev/null; then
    read -rp "   Install Python 3 via Homebrew? [y/N] " yn
    if [[ "$yn" =~ ^[Yy]$ ]]; then
      info "Installing Python 3..."
      brew install python@3
      HAS_PYTHON=true
      ok "Python installed: $(python3 --version)"
    fi
  else
    echo "   Please install Python 3.10+ from one of these options:"
    echo "     • https://python.org/downloads/  (recommended for beginners)"
    echo "     • brew install python@3           (if you install Homebrew first: https://brew.sh)"
    echo ""
  fi
fi

# ── 1c. Hard gate — both are required ────────────────────────────────────────
if [ "$HAS_NODE" = false ] || [ "$HAS_PYTHON" = false ]; then
  echo ""
  echo "┌─────────────────────────────────────────────────────────────────┐"
  echo "│  ❌  Missing required prerequisites:                            │"
  if [ "$HAS_NODE" = false ]; then
  echo "│      • Node.js  — needed to run the frontend                    │"
  fi
  if [ "$HAS_PYTHON" = false ]; then
  echo "│      • Python 3 — needed to run the backend                     │"
  fi
  echo "│                                                                 │"
  echo "│  HearthNet needs both to work. Please install the missing       │"
  echo "│  tools above, then re-run:  ./start.sh                          │"
  echo "└─────────────────────────────────────────────────────────────────┘"
  echo ""
  exit 1
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Environment setup
# ══════════════════════════════════════════════════════════════════════════════

# ── 2. Ensure .env exists ─────────────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  info "Creating .env from .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
  ok ".env created. You can edit it later to add optional settings."
fi

# Load env vars
set -a; source "$ROOT/.env"; set +a

# ── 3. Check API Key (optional — warn, don't block) ──────────────────────────
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "your_anthropic_api_key_here" ]; then
  AI_ENABLED=false
  echo ""
  echo "┌─────────────────────────────────────────────────────────────────┐"
  echo "│  ℹ️   No Anthropic API key found — AI features are disabled.    │"
  echo "│                                                                 │"
  echo "│  What still works perfectly:                                    │"
  echo "│    ✅ CSV uploads (Chase, Amex, Discover, Citi, PNC, etc.)      │"
  echo "│    ✅ Excel (.xlsx) uploads                                     │"
  echo "│    ✅ Digital PDF statements                                    │"
  echo "│    ✅ Full dashboard & analytics                                │"
  echo "│                                                                 │"
  echo "│  What's disabled:                                               │"
  echo "│    ⛔ Scanned/image PDF parsing                                 │"
  echo "│    ⛔ Screenshot (.png/.jpg) parsing                            │"
  echo "│                                                                 │"
  echo "│  To enable AI: add ANTHROPIC_API_KEY to .env                    │"
  echo "│  Get a key at: https://console.anthropic.com/                   │"
  echo "└─────────────────────────────────────────────────────────────────┘"
  echo ""
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Start backend
# ══════════════════════════════════════════════════════════════════════════════

info "Setting up Python backend..."
cd "$ROOT/backend"

if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment..."
  if command -v python3 &>/dev/null; then
    python3 -m venv .venv
  else
    python -m venv .venv
  fi
fi
source .venv/bin/activate

# Smart pip install: only re-run if requirements changed or venv is fresh
REQ_HASH_FILE="$ROOT/backend/.venv/.req_hash"
CURRENT_HASH=$(shasum "$ROOT/backend/requirements.txt" 2>/dev/null | awk '{print $1}')

if [ ! -f "$REQ_HASH_FILE" ] || [ "$(cat "$REQ_HASH_FILE" 2>/dev/null)" != "$CURRENT_HASH" ]; then
  if [ "$AI_ENABLED" = true ]; then
    info "Installing Python dependencies (with AI support)..."
    pip install -q -r requirements.txt
  else
    info "Installing Python dependencies (skipping Anthropic SDK — no API key)..."
    grep -vi "^anthropic" requirements.txt | pip install -q -r /dev/stdin
  fi
  echo "$CURRENT_HASH" > "$REQ_HASH_FILE"
else
  ok "Python dependencies up to date."
fi

info "Starting backend on http://localhost:8000 ..."
cp "$ROOT/.env" "$ROOT/backend/.env" 2>/dev/null || true
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Start frontend
# ══════════════════════════════════════════════════════════════════════════════

info "Setting up frontend..."
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  info "Installing frontend dependencies (this may take a minute on first run)..."
  npm install
fi

info "Starting frontend on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Ready
# ══════════════════════════════════════════════════════════════════════════════

sleep 3
if command -v open &>/dev/null; then
  open "http://localhost:5173"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:5173"
fi

echo ""
ok "HearthNet Dashboard is running!"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:8000"
if [ "$AI_ENABLED" = false ]; then
  echo "   AI Mode:  disabled (add ANTHROPIC_API_KEY to .env to enable)"
fi
echo "   Press Ctrl+C to stop."
echo ""

wait $BACKEND_PID $FRONTEND_PID

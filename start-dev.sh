#!/bin/bash
# Kill any existing processes on ports 3001 and 5000
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 5000/tcp 2>/dev/null || true

# Build API server
echo "Building API server..."
cd /home/runner/workspace
pnpm --filter @workspace/api-server run build

# Start API server on port 3001 in background
echo "Starting API server on port 3001..."
PORT=3001 NODE_ENV=development node --enable-source-maps artifacts/api-server/dist/index.mjs &
API_PID=$!

# Wait for API server to be ready
sleep 2

# Start Vite dev server on port 5000 (proxies /api to port 3001)
echo "Starting Vite dev server on port 5000..."
PORT=5000 pnpm --filter @workspace/wedding-app run dev &
VITE_PID=$!

echo "API server PID: $API_PID (port 3001)"
echo "Vite server PID: $VITE_PID (port 5000)"

# Wait for either to exit
wait -n

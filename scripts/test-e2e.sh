#!/usr/bin/env bash
# Run E2E tests locally.
#
# Usage:
#   scripts/test-e2e.sh           # all tests (VRT + live)
#   scripts/test-e2e.sh vrt       # VRT-only (mocked API, no server needed)
#   scripts/test-e2e.sh live      # live-only (real server required)
#
# Extra arguments are forwarded to Playwright:
#   scripts/test-e2e.sh live --headed
#   scripts/test-e2e.sh vrt --ui

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MODE="${1:-all}"
shift 2>/dev/null || true

VRT_SPECS=(
    admin.spec.ts
    session-list.spec.ts
    session-detail-recorded.spec.ts
    session-detail-live.spec.ts
)
LIVE_SPECS=(
    live-session-reconnect.spec.ts
    live-session-shared-reconnect.spec.ts
)

check_live_prereqs() {
    local ok=true

    if [[ ! -f packages/client/dist/index.js ]]; then
        echo "Client SDK not built. Building now..."
        yarn build:client
    fi

    if ! curl -sf http://localhost:8977/v1/auth/config > /dev/null 2>&1; then
        echo "Error: API server not reachable at localhost:8977."
        echo "Start it with: yarn dev:api"
        ok=false
    fi

    if [[ "$ok" != true ]]; then
        exit 1
    fi
}

run_playwright() {
    cd packages/ui
    yarn test:e2e "$@"
}

case "$MODE" in
    vrt)
        echo "Running VRT tests (mocked API, no server needed)..."
        run_playwright "${VRT_SPECS[@]}" "$@"
        ;;
    live)
        check_live_prereqs
        echo "Running live E2E tests (real server required)..."
        run_playwright "${LIVE_SPECS[@]}" "$@"
        ;;
    all)
        check_live_prereqs
        echo "Running all E2E tests..."
        run_playwright "$@"
        ;;
    *)
        echo "Usage: scripts/test-e2e.sh [vrt|live|all] [-- playwright args...]"
        echo ""
        echo "Modes:"
        echo "  vrt   VRT tests only (mocked API, no server needed)"
        echo "  live  Live session tests only (requires running API server)"
        echo "  all   All E2E tests (default)"
        exit 1
        ;;
esac

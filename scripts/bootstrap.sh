#!/usr/bin/env bash
# Push the Keep in Touch example (keep-in-touch.genome, keep-in-touch.app, platform) and import it. Arguments pass through to `artyfact init`.
cd "$(dirname "$0")/.." && exec npx --no-install artyfact init --genome examples/keep-in-touch-system --app examples/keep-in-touch-app "$@"

#!/usr/bin/env bash
# Push the Peopling example (peopling.genome, peopling.app, platform) and import it. Arguments pass through to `artyfact init`.
cd "$(dirname "$0")/.." && exec npx --no-install artyfact init --genome examples/peopling-system --app examples/peopling-app "$@"

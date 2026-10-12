#!/usr/bin/env bash
# Push the example System and app into Cloudflare Artifacts (namespace + repos kit-system, kit-app).
# Idempotent: existing namespace/repos are reused; a repo that already has `main` is not overwritten.
# Usage: scripts/bootstrap.sh [--dry-run]    Env: ACCOUNT_ID, ARTIFACTS_NAMESPACE (default artyfact)
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NS="${ARTIFACTS_NAMESPACE:-artyfact}"

# repo-name:source-dir
TARGETS=("kit-system:examples/keep-in-touch-system" "kit-app:examples/keep-in-touch-app")

command -v wrangler >/dev/null 2>&1 || wrangler() { npx --no-install wrangler "$@"; }

log() { printf '%s\n' "$*"; }

# Print the command in dry-run mode, run it otherwise.
run() {
  if [ "$DRY_RUN" = 1 ]; then log "+ $*"; else "$@"; fi
}

resolve_account_id() {
  if [ -n "${ACCOUNT_ID:-}" ]; then return; fi
  if [ "$DRY_RUN" = 1 ]; then ACCOUNT_ID="<ACCOUNT_ID>"; return; fi
  ACCOUNT_ID="$(wrangler whoami 2>/dev/null | grep -Eo '[0-9a-f]{32}' | head -n1 || true)"
  [ -n "$ACCOUNT_ID" ] || { echo "ACCOUNT_ID not set and not found in 'wrangler whoami'" >&2; exit 1; }
}

remote_url() { printf 'https://%s.artifacts.cloudflare.net/git/%s/%s.git' "$ACCOUNT_ID" "$NS" "$1"; }

ensure_namespace() {
  if [ "$DRY_RUN" = 1 ]; then
    log "+ wrangler artifacts namespaces get $NS || cf artifacts namespaces create $NS"
    return
  fi
  if wrangler artifacts namespaces get "$NS" >/dev/null 2>&1; then return; fi
  if command -v cf >/dev/null 2>&1; then
    cf artifacts namespaces create "$NS" >/dev/null
  else
    echo "namespace '$NS' not found and 'cf' is unavailable; create it, then re-run" >&2
    exit 1
  fi
}

ensure_repo() {
  local repo="$1"
  if [ "$DRY_RUN" = 1 ]; then
    log "+ wrangler artifacts repos get $repo --namespace $NS || wrangler artifacts repos create $repo --namespace $NS"
    return
  fi
  wrangler artifacts repos get "$repo" --namespace "$NS" >/dev/null 2>&1 \
    || wrangler artifacts repos create "$repo" --namespace "$NS" >/dev/null
}

# Issues a write token and prints it to stdout only (callers must keep it out of logs).
issue_token() {
  wrangler artifacts repos issue-token "$1" --namespace "$NS" --scope write --ttl 3600 --json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const t=j.token??j.value??j.plaintext??(j.result&&(j.result.token??j.result.value));if(!t){console.error("no token in response");process.exit(1)}process.stdout.write(String(t))})'
}

# git with the bearer header supplied through the environment so the token never appears in argv.
authed_git() {
  local token="$1"; shift
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Bearer $token" git "$@"
}

head_of() { # token url -> commit or empty
  authed_git "$1" ls-remote "$2" refs/heads/main 2>/dev/null | cut -f1
}

push_repo() {
  local repo="$1" src="$2" url
  url="$(remote_url "$repo")"
  if [ "$DRY_RUN" = 1 ]; then
    log "+ token=\$(wrangler artifacts repos issue-token $repo --namespace $NS --scope write --ttl 3600 --json)"
    log "+ git ls-remote $url refs/heads/main   # skip push if main exists"
    log "+ tmp=\$(mktemp -d) && cp -R $src/. \$tmp && git -C \$tmp init -b main && git -C \$tmp add -A && git -C \$tmp commit -m 'Initial import'"
    log "+ git -C \$tmp push $url HEAD:main   # Authorization: Bearer <token> via http.extraHeader"
    return
  fi
  [ -d "$ROOT/$src" ] || { echo "missing $ROOT/$src" >&2; exit 1; }
  local token tmp head
  token="$(issue_token "$repo")"
  head="$(head_of "$token" "$url")"
  if [ -z "$head" ]; then
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    (cd "$ROOT/$src" && tar --exclude node_modules --exclude .wrangler --exclude .git -cf - .) | tar -xf - -C "$tmp"
    git -C "$tmp" init -q -b main
    git -C "$tmp" add -A
    git -C "$tmp" -c user.name=artyfact -c user.email=artyfact@localhost commit -q -m "Initial import"
    authed_git "$token" -C "$tmp" push -q "$url" HEAD:main
    head="$(git -C "$tmp" rev-parse HEAD)"
  fi
  printf '%s head: %s\n' "$repo" "$head"
}

resolve_account_id
log "account: $ACCOUNT_ID  namespace: $NS"
ensure_namespace
for t in "${TARGETS[@]}"; do
  repo="${t%%:*}"; src="${t#*:}"
  ensure_repo "$repo"
  push_repo "$repo" "$src"
done

log ""
log "Import into the platform (apps/platform dev server):"
log "curl -XPOST localhost:5173/api/systems/import -H 'content-type: application/json' -d '{\"systemId\":\"system.keep-in-touch\",\"genomeRepo\":\"kit-system\",\"appRepo\":\"kit-app\"}'"

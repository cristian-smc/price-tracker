#!/usr/bin/env bash
# Manual fast-forward Git updater. Stages dependencies before changing the checkout.
set -euo pipefail
COMPANION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -eq 0 ]] || { printf 'Usage: bash update.sh (manual update only)\n' >&2; exit 1; }

# Parse the function before running it: updating this file cannot change the
# commands still being read by this invocation.
update_companion() {
for tool in git node npm flock tar; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'ERROR: missing %s. Run setup.sh first.\n' "$tool" >&2; exit 1; }
done
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=30}"
REPO_DIR="$(git -C "$COMPANION_DIR" rev-parse --show-toplevel)"
# Automatic code installation only follows the checkout's configured upstream.
# Never guess a branch, force-reset edits, or pull from an arbitrary URL.
BRANCH="$(git -C "$REPO_DIR" symbolic-ref --quiet --short HEAD)" || {
  printf 'ERROR: detached checkout; select a branch with an upstream first.\n' >&2; exit 1;
}
UPSTREAM="$(git -C "$REPO_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')"
REMOTE="$(git -C "$REPO_DIR" config --get "branch.$BRANCH.remote")"
[[ -n "$REMOTE" && "$REMOTE" != '.' ]] || { printf 'ERROR: a remote upstream is required.\n' >&2; exit 1; }
exec 9>"$COMPANION_DIR/.operation.lock"
if ! flock -n 9; then printf 'SKIPPED: another PriceWatch check or update is running.\n'; exit 75; fi
BOOTSTRAP=0
if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]]; then
  # Copying this updater over an older tracked version is allowed only when it
  # exactly matches the fetched upstream file. All other local edits are refused.
  if git -C "$REPO_DIR" diff --cached --quiet &&
     git -C "$REPO_DIR" diff --quiet -- . ':(exclude)companion/update.sh'; then BOOTSTRAP=1;
  else
    printf 'ERROR: tracked files have local edits. Update stopped; no edits were discarded.\n' >&2
    exit 1
  fi
fi
printf 'Checking upstream %s for %s...\n' "$UPSTREAM" "$BRANCH"
# Bound network waits; cron cannot answer an authentication prompt.
if command -v timeout >/dev/null 2>&1; then timeout 120 git -C "$REPO_DIR" fetch "$REMOTE";
else git -C "$REPO_DIR" fetch "$REMOTE"; fi
PREVIOUS="$(git -C "$REPO_DIR" rev-parse HEAD)"
TARGET="$(git -C "$REPO_DIR" rev-parse "$UPSTREAM")"
if [[ "$PREVIOUS" == "$TARGET" ]]; then
  if [[ "$BOOTSTRAP" -eq 1 ]]; then printf 'ERROR: copied updater does not match a new upstream release yet.\n' >&2; exit 1; fi
  printf 'Already up to date (%s).\n' "${TARGET:0:12}"; return 0;
fi
if ! git -C "$REPO_DIR" merge-base --is-ancestor "$PREVIOUS" "$TARGET"; then
  printf 'ERROR: local branch diverged from upstream. Update stopped; no reset or merge performed.\n' >&2
  exit 1
fi
# Runtime data must never become a tracked release file that Git might replace.
for name in config.json pricewatch.json state.json check.log update.log .operation.lock; do
  if [[ -n "$(git -C "$REPO_DIR" ls-tree --name-only HEAD -- "companion/$name")" ||
        -n "$(git -C "$REPO_DIR" ls-tree --name-only "$TARGET" -- "companion/$name")" ]]; then
    printf 'ERROR: upstream tracks runtime file %s; refusing to overwrite phone data.\n' "$name" >&2
    exit 1
  fi
done
STAGE="$(mktemp -d "$COMPANION_DIR/.update-stage.XXXXXX")"
BACKUP="$STAGE/previous-node_modules"
INSTALLED=0
COMMITTED=0
cleanup() {
  status=$?
  if [[ "$status" -ne 0 && "$INSTALLED" -eq 1 && "$COMMITTED" -eq 0 ]]; then
    rm -rf -- "$COMPANION_DIR/node_modules"
    if [[ -d "$BACKUP" ]]; then mv "$BACKUP" "$COMPANION_DIR/node_modules"; fi
    printf 'Dependency installation rolled back; original Git revision remains installed.\n' >&2
  fi
  rm -rf -- "$STAGE"
  exit "$status"
}
trap cleanup EXIT
# Stage files from the exact fetched commit; no user config is copied or read.
git -C "$REPO_DIR" archive "$TARGET" companion | tar -x -C "$STAGE"
CANDIDATE="$STAGE/companion"
[[ -f "$CANDIDATE/check.js" && -f "$CANDIDATE/package-lock.json" && -f "$CANDIDATE/install-widgets.sh" && -f "$CANDIDATE/run-check.sh" ]] || {
  printf 'ERROR: upstream does not contain the standalone updater release yet.\n' >&2; exit 1;
}
if ! git -C "$REPO_DIR" cat-file -e 'HEAD:companion/update.sh' 2>/dev/null; then BOOTSTRAP=2; fi
if [[ "$BOOTSTRAP" -ne 0 ]] && ! cmp -s "$COMPANION_DIR/update.sh" "$CANDIDATE/update.sh"; then
  printf 'ERROR: local updater differs from the upstream release; no local edits were discarded.\n' >&2
  exit 1
fi
node --check "$CANDIDATE/check.js"
for script in "$CANDIDATE/"*.sh "$CANDIDATE/widget/"*.sh; do bash -n "$script"; done
# The companion has no required install scripts. Do not execute package hooks.
(cd "$CANDIDATE" && npm ci --engine-strict --ignore-scripts --no-audit --no-fund && node --input-type=module -e "await import('cheerio'); console.log('Staged parser loads successfully');")
if [[ -d "$COMPANION_DIR/node_modules" ]]; then mv "$COMPANION_DIR/node_modules" "$BACKUP"; fi
INSTALLED=1
mv "$CANDIDATE/node_modules" "$COMPANION_DIR/node_modules"
# Rechecks fast-forward and local-file collisions. Failure restores dependencies.
if [[ "$BOOTSTRAP" -eq 1 ]]; then
  # Save the identical copied script, restore just its old tracked bytes so Git
  # can fast-forward, and put the copy back if the fast-forward fails.
  cp "$COMPANION_DIR/update.sh" "$STAGE/copied-update.sh"
  git -C "$REPO_DIR" show "HEAD:companion/update.sh" > "$STAGE/old-update.sh"
  cp "$STAGE/old-update.sh" "$COMPANION_DIR/update.sh"
  if ! git -C "$REPO_DIR" merge --ff-only "$TARGET"; then
    cp "$STAGE/copied-update.sh" "$COMPANION_DIR/update.sh"
    exit 1
  fi
elif [[ "$BOOTSTRAP" -eq 2 ]]; then
  # Three-file installs have no tracked updater. Move the identical copied file
  # out of Git's way, then restore it if Git refuses another file collision.
  cp "$COMPANION_DIR/update.sh" "$STAGE/copied-update.sh"
  rm -- "$COMPANION_DIR/update.sh"
  if ! git -C "$REPO_DIR" merge --ff-only "$TARGET"; then
    cp "$STAGE/copied-update.sh" "$COMPANION_DIR/update.sh"
    exit 1
  fi
else
  git -C "$REPO_DIR" merge --ff-only "$TARGET"
fi
COMMITTED=1
bash "$COMPANION_DIR/install-widgets.sh"
if command -v crond >/dev/null 2>&1 && ! pgrep -x crond >/dev/null; then crond; fi
printf 'Updated successfully: %s -> %s. Configuration, products, state and logs preserved.\n' "${PREVIOUS:0:12}" "${TARGET:0:12}"
}
update_companion

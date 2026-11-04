#!/usr/bin/env bash
set -euo pipefail
REPO_URL="https://github.com/Jakeschincariol/replica-skill.git"
REPLICA_COMMIT="77c9436fb3d18c3d58169efb8caf4fe906b0dc51"
SCOPE="both"; FORCE="false"
usage(){ echo "Usage: $0 [--scope both|global|project] [--force]"; }
while (($#)); do case "$1" in
  --scope) [[ $# -ge 2 ]] || { usage; exit 2; }; SCOPE="$2"; shift 2;;
  --force) FORCE="true"; shift;;
  -h|--help) usage; exit 0;;
  *) echo "Unknown argument: $1" >&2; usage; exit 2;;
esac; done
case "$SCOPE" in both|global|project);; *) usage; exit 2;; esac
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"; trap 'rm -rf "$TMP_ROOT"' EXIT
git clone --quiet --no-checkout "$REPO_URL" "$TMP_ROOT/replica-skill"
git -C "$TMP_ROOT/replica-skill" checkout --quiet "$REPLICA_COMMIT"
install_to(){
  local dest="$1"; mkdir -p "$dest"; cp "$TMP_ROOT/replica-skill/LICENSE" "$dest/replica-skill-LICENSE.txt"; local count=0
  for source in "$TMP_ROOT"/replica-skill/replica-*; do
    [[ -d "$source" ]] || continue
    local target="$dest/$(basename "$source")"
    if [[ -e "$target" ]]; then
      if [[ "$FORCE" == true ]]; then rm -rf "$target"; else echo "SKIP existing $target"; continue; fi
    fi
    cp -R "$source" "$target"; count=$((count+1))
  done
  echo "Installed $count skill folders into $dest"
}
if [[ "$SCOPE" == both || "$SCOPE" == global ]]; then install_to "$HOME/.claude/skills"; fi
if [[ "$SCOPE" == both || "$SCOPE" == project ]]; then install_to "$PROJECT_ROOT/.claude/skills"; fi
if command -v python3 >/dev/null; then python3 --version; else echo "WARNING: Python 3.8+ needed by some helper scripts"; fi
echo "Reload Claude Code and verify /replica-* skills."

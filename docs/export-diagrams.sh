#!/usr/bin/env bash
# Export every Mermaid diagram in docs/architecture.md to docs/diagrams/NN-name.svg.
# One-off tool via npx (not a project dependency; downloads a headless Chromium once).
set -euo pipefail

cd "$(dirname "$0")"
MERMAID_CLI="@mermaid-js/mermaid-cli@12.0.0"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p diagrams

# Split the markdown: each ```mermaid block becomes NN-<slug of the heading above it>.mmd
awk -v dir="$work" '
  /^## / { title = $0; sub(/^## [0-9]+\. /, "", title); gsub(/[^A-Za-z0-9]+/, "-", title); title = tolower(title) }
  /^```mermaid/ { n++; file = sprintf("%s/%02d-%s.mmd", dir, n, title); inblock = 1; next }
  /^```/ && inblock { inblock = 0; close(file); next }
  inblock { print > file }
' architecture.md

for source in "$work"/*.mmd; do
  name="$(basename "$source" .mmd)"
  npx -y "$MERMAID_CLI" --quiet -i "$source" -o "diagrams/$name.svg" -b white
  echo "diagrams/$name.svg"
done

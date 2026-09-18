#!/usr/bin/env bash
# Patch: add empty-state to Emergency Units when no trucks are registered.
# Target file (edit APP_DIR if your path differs):
#   artifacts/fiarep-mobile/app/emergency-units.tsx
# Run from the repo root, e.g. ~/Desktop/FIAREP-Backend-2
set -euo pipefail

APP_DIR="${APP_DIR:-artifacts/fiarep-mobile}"
TARGET="$APP_DIR/app/emergency-units.tsx"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: $TARGET not found. cd to the repo root, or set APP_DIR=... before running." >&2
  exit 1
fi

# The anchor: the closing of the units.map wrapper View, immediately before the
# loadedTruck header. We insert an empty-state line right after that </View>.
ANCHOR='      </View>

      {!!loadedTruck && <Text style={[ui.h, { marginTop: 16 }]}>{loadedTruck}</Text>}'

REPLACEMENT='      </View>

      {units.length === 0 && (
        <Text style={[ui.empty, { marginTop: 20 }]}>No emergency units registered yet. Register a truck in Manage Trucks first.</Text>
      )}

      {!!loadedTruck && <Text style={[ui.h, { marginTop: 16 }]}>{loadedTruck}</Text>}'

if ! grep -qF "$ANCHOR" "$TARGET"; then
  if grep -qF 'No emergency units registered yet' "$TARGET"; then
    echo "Already patched — empty-state present. Nothing to do."
    exit 0
  fi
  echo "ERROR: anchor not found in $TARGET. File may have changed; not modifying." >&2
  exit 1
fi

python3 - "$TARGET" << 'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
anchor = '''      </View>

      {!!loadedTruck && <Text style={[ui.h, { marginTop: 16 }]}>{loadedTruck}</Text>}'''
replacement = '''      </View>

      {units.length === 0 && (
        <Text style={[ui.empty, { marginTop: 20 }]}>No emergency units registered yet. Register a truck in Manage Trucks first.</Text>
      )}

      {!!loadedTruck && <Text style={[ui.h, { marginTop: 16 }]}>{loadedTruck}</Text>}'''
assert s.count(anchor) == 1, "anchor not unique (%d matches)" % s.count(anchor)
open(p, "w", encoding="utf-8").write(s.replace(anchor, replacement, 1))
print("Patched:", p)
PY

echo
echo "Done. Now verify and typecheck:"
echo "  grep -n 'No emergency units registered yet' $TARGET"
echo "  ( cd $APP_DIR && npx tsc -p tsconfig.json --noEmit )   # or your typecheck script"

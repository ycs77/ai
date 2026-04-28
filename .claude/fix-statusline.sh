#!/bin/bash
set -euo pipefail

TARGET="$(dirname "$0")/statusline.sh"

[ -f "$TARGET" ] || { echo "Error: $TARGET not found." >&2; exit 1; }

# [1] Restrict cache directory permissions to owner-only after creation
sed -i 's|mkdir -p "\$CACHE_DIR"|mkdir -p "$CACHE_DIR" \&\& chmod 700 "$CACHE_DIR"|' "$TARGET"

# [2] Set umask 077 before writing the tmp file so it is created with owner-only permissions
sed -i '/printf .%s. "\$input" | jq .{rate_limits: .rate_limits}./{i\  umask 077
}' "$TARGET"

# [3] Remove DIM formatting from label text (Context, 5h:, 7d:, reset brackets)
sed -i \
  -e 's|"${DIM}Context${RESET} |"Context |' \
  -e 's|"${DIM}5h:${RESET} |"5h: |' \
  -e 's| ${DIM}(${reset_str})${RESET}"| (${reset_str})"|' \
  -e 's|"${DIM}7d:${RESET} |"7d: |' \
  "$TARGET"

echo "Done. Patches applied."

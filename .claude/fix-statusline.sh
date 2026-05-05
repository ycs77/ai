#!/bin/bash
set -euo pipefail

TARGET="$(dirname "$0")/statusline.sh"

[ -f "$TARGET" ] || { echo "Error: $TARGET not found." >&2; exit 1; }

# [1] Restrict cache directory permissions to owner-only after creation
grep -q 'chmod 700 "$CACHE_DIR"' "$TARGET" \
  || sed -i 's|mkdir -p "\$CACHE_DIR"|mkdir -p "$CACHE_DIR" \&\& chmod 700 "$CACHE_DIR"|' "$TARGET"

# [2] Set umask 077 before writing the tmp file so it is created with owner-only permissions
grep -q '^  umask 077$' "$TARGET" \
  || sed -i '/printf .%s. "\$input" | jq .{rate_limits: .rate_limits}./{i\  umask 077
}' "$TARGET"

# [3] Remove DIM formatting from label text (Context, 5h:, 7d:, reset brackets)
sed -i \
  -e 's|"${DIM}Context${RESET} |"Context |' \
  -e 's|"${DIM}5h:${RESET} |"5h: |' \
  -e 's| ${DIM}(${reset_str})${RESET}"| (${reset_str})"|' \
  -e 's|"${DIM}7d:${RESET} |"7d: |' \
  "$TARGET"

# [4] Replace format_reset() to show clock time + remaining (e.g. "18:30, 4h23m"),
#     switching to "MM/DD HH:MM" when reset is on a different day
sed -i '/^# Format seconds remaining as/,/^}$/c\
# Format reset time as "HH:MM, 4h23m" (clock time + remaining)\
format_reset() {\
  local ts="$1"\
  [ -z "$ts" ] && return\
  local epoch now diff\
  epoch=$(printf '"'"'%s'"'"' "$ts" | tr -dc '"'"'0-9'"'"')\
  [ -z "$epoch" ] && return\
  now=$(date +%s)\
  diff=$((epoch - now))\
  [ "$diff" -le 0 ] && return\
  local today target clock_fmt="+%H:%M"\
  today=$(date +%Y%m%d)\
  target=$(date -d "@$epoch" +%Y%m%d 2>/dev/null \\\
    || date -r "$epoch" +%Y%m%d 2>/dev/null)\
  if [ -n "$target" ] && [ "$target" != "$today" ]; then\
    clock_fmt="+%m/%d %H:%M"\
  fi\
  local clock=""\
  clock=$(date -d "@$epoch" "$clock_fmt" 2>/dev/null \\\
    || date -r "$epoch" "$clock_fmt" 2>/dev/null)\
  local mins=$(( diff / 60 ))\
  local hours=$(( mins / 60 ))\
  local days=$(( hours / 24 ))\
  local remaining=""\
  if [ "$days" -ge 1 ]; then\
    remaining=$(printf "%dd%dh" "$days" $(( hours % 24 )))\
  elif [ "$hours" -ge 1 ]; then\
    remaining=$(printf "%dh%dm" "$hours" $(( mins % 60 )))\
  else\
    remaining=$(printf "%dm" "$mins")\
  fi\
  if [ -n "$clock" ]; then\
    printf "%s, %s" "$clock" "$remaining"\
  else\
    printf "%s" "$remaining"\
  fi\
}' "$TARGET"

echo "Done. Patches applied."

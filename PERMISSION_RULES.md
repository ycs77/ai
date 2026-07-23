# AI Permission Rules

All permission rules fall into three tiers, progressively stricter:

| Tier | Behavior | Applies to |
|---|---|---|
| **Allow** | Auto-approve | Low-risk, reversible, no external state changes |
| **Ask** | Prompt for confirmation | Destructive, irreversible, external state changes, supply-chain risk |
| **Deny** | Block outright | Secret exposure, disk-level destruction, system ops outside dev workflow |

Core principle: **allow-first, minimize approval fatigue.** Users rubber-stamp approvals when asked too often—manual review becomes theater, which is itself a security hole.

## Allow

- Read and query
- Version checks
- Local build and test
- Git read-only operations

## Ask

- File deletion (across all shells)
- Git destructive operations (history rewrite, force push, discarding uncommitted work)
- Package install / remove (supply-chain risk)
- Remote script execution
- Docker data removal
- Process kill, file overwrite, remote transfer
- System permission changes

AI generates destructive commands the user never asked for—in a real incident, a harmless task led the AI to spontaneously run recursive deletion, wiping the entire system drive. **Block behavior categories, not specific commands.**

## Deny

- Secret reads (env vars, keys, certs, cloud and SSH config dirs)
- Disk-level destruction (format, direct block device writes)
- System power control
- Registry deletion
- Public package publish

No legitimate dev scenario needs these. Asking only adds fatigue. Deny is structural enforcement, not human judgment.

## Cross-tool notes

- **Glob precedence**: check whether the tool uses first-match or last-match before placing `"*"`. A wrong position lets `"*"` shadow deny rules.
- **Pipe and redirect**: glob can't reliably catch pipe + redirect combos (e.g. exfiltrating secrets via pipe). The three-tier model covers the highest-frequency destructive classes; airtight safety still needs workspace isolation + OS-level guards.
- **Match target**: check whether the tool matches against the raw command string or parsed AST—this affects pattern writing.

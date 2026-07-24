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


## OMP-specific

- **approvalMode: write (not yolo)**: auto-approve read/write tiers; exec tier requires prompt. In yolo mode, CRITICAL_BASH_PATTERNS returns no policy field, which is treated as "no opinion" and auto-approved. Write mode routes it through the override branch, correctly triggering a prompt.
- **CRITICAL_BASH_PATTERNS is a built-in safety net**: covers `rm -rf /`, `curl|bash`, `chmod -R /`, fork bombs, etc. It matches after user deny but before user prompt/allow, returning no policy — in yolo this preempts user prompt rules and silently auto-approves (known bug); in write mode it correctly triggers prompt.
- **Don't duplicate CRITICAL-overlapping user prompt rules**: `rm*`, `chmod*`, `chown*`, `curl|bash`, `bash <(curl...)`, `eval "$(curl...)"` — CRITICAL already covers their dangerous variants. Only keep narrowed prompt rules for non-dangerous variants (e.g. `rm -rf*`, `chmod -R*`).
- **Allow-skip mechanism**: commands containing shell-control chars (`|`, `>`, `$()`, etc.) skip `approval: allow` rules and fall to bare exec tier — in write mode this triggers an extra prompt, forming a guard net for piped/redirected commands.
- **First-match semantics**: deny rules sit before prompt rules; catch-all `*` → allow must be last. `.env.example` must be explicitly allowed before the broader `cat *env*` → deny.
- **Linux patterns retained on Windows**: `/etc/passwd`, `/dev/sd*`, `init 0`, etc. don't exist on Windows but AI may run them via SSH/WSL/Docker — kept consistent with `rm -rf /` → deny.

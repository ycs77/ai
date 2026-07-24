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
- **Bash interceptor boundary**: `bashInterceptor.enabled` defaults to `false`, and its rules redirect common shell operations to dedicated tools only when enabled. Protected-path enforcement does not depend on it.

### Protected path policy

`.omp/agent/hooks/pre/permission-guard.ts` is the primary protected-path boundary. `read`, `write`, `grep`, `edit`, and `bash` all use its single ordered `FILE_RULES` policy. The YAML Bash patterns are supplemental defense only.

- `read` and `write` inspect every path input. `grep` accepts both `path` and `paths`, including string arrays and comma/semicolon-delimited values. `edit` inspects every `[PATH#TAG]` section.
- Rules use first-match semantics for each candidate. The completed candidate decisions are then aggregated for the whole tool call with `deny > prompt > allow` precedence. A basename exactly equal to `.env.example` is allowed, but it never exempts another candidate in the same call.
- Local relative paths are evaluated in their original normalized form, after resolution against the effective working directory, and against that working directory itself. This prevents `..` or a protected working directory from hiding `secrets`, `.aws`, `.ssh`, or `.ss`.
- Protected extensions (`.env`, `.pem`, `.key`, and `.crt`) are matched case-insensitively. The ordered `.env.example` allow rule remains the exact exception.
- Denial and confirmation messages identify only the matched policy or unsupported syntax. They never echo a complete command, candidate path, `env` object, or environment value.

#### Protocol handling

| Protocol class | Behavior |
|---|---|
| Local paths and `file://` | Convert to a filesystem path, normalize, then check |
| `ssh://` | Decode and check the remote absolute URL path; the SSH handler does not expand `~` |
| `vault://` | Decode and check the vault-relative path; the handler itself confines access to an Obsidian vault root |
| `http://`, `https://` | Skip filesystem-path policy |
| Confirmed virtual/internal URIs (`agent://`, `artifact://`, `history://`, `issue://`, `local://`, `mcp://`, `memory://`, `omp://`, `pr://`, `rule://`, `skill://`, `xd://`) | Skip filesystem-path policy |
| Unknown protocols | Deny; never default-allow |

#### Shell handling

- Checks `command`, the effective `cwd`, and every value in the caller-supplied `env` object. It never reads or expands host environment variables.
- Shell commands are not parsed by command name or argument semantics. The raw command is split on lexical Shell boundaries, and every non-empty fragment is evaluated by the same `checkPath()` and ordered `FILE_RULES` policy used by dedicated tools.
- Pipes, redirects, parentheses, brace groups, and control structures therefore cannot hide a literal protected path. The exact `.env.example` exception remains scoped to its own fragment.
- This policy is intentionally conservative. A protected-looking word can be denied even when it was intended as a search pattern, comment, or output text.
- Variables, command substitution, unbalanced quotes, encoded commands, and nested execution that accepts a command string produce a prompt decision. Literal denies take precedence; otherwise one confirmation is shown per tool call when UI is available, and headless/no-UI calls fail closed.

#### Cross-tool behavior

- YAML globs cannot reliably understand pipe and redirect combinations. The pre-hook scans raw Shell text independently of command grammar; workspace isolation and OS-level guards remain necessary for airtight enforcement.
- The YAML matcher sees command text, while the pre-hook evaluates protected-looking lexical fragments. Keep the pre-hook as the protected-path authority.

#### Known limits

- This is not a complete Bash, PowerShell, or cmd parser, an OS sandbox, or a replacement for filesystem permissions/process isolation.
- It does not attempt to defeat arbitrary encoding, multi-stage expansion, intentional obfuscation, or a general-purpose program that opens files itself.
- It does not inspect the returned contents of virtual/internal URIs.
- Archive, SQLite, and selector semantics remain owned by their tools; the hook only removes recognized read selectors before checking the candidate path.

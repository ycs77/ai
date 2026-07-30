# OMP Permission Rules

This document applies the [AI permission model](./README.md) to OMP. The first half records stable design decisions and their rationale. The second half describes the current implementation.

## Design decisions

### Use guarded execution by default

Low-risk work should remain automatic, but an unclassified Shell operation must not become implicitly allowed. When execution falls outside an explicit rule, OMP should route it through a mode that requires confirmation rather than treating the absence of a policy as approval.

### Keep protected-path policy centralized

Every tool capable of accessing filesystem paths must reach the same policy decision for the same protected resource. Tool-specific configuration may supplement this boundary, but it must not become an alternate source of truth that can drift or be bypassed through another tool.

### Make explicit denial take precedence

A known protected path is a direct policy violation, not an uncertainty for the user to resolve. Evaluate literal protected-path candidates before dynamic-command rules so a denial cannot be downgraded to a confirmation prompt. Keep exceptions narrow and ordered before broader rules only when the exception is intentional.

### Fail closed when input cannot be inspected

Dynamic expansion, nested execution, encoded commands, malformed syntax, and unknown protocols can hide the resource or behavior being requested. Ask once when an interactive confirmation is available; deny when running headlessly. Never default-allow an input simply because its meaning could not be determined.

### Prefer conservative matching for sensitive paths

For secret-bearing directories and filenames, the cost of a missed match is higher than the cost of a false positive. Preserve protected-looking unresolved path segments and related directory suffixes instead of normalizing them into a potentially less restrictive interpretation. Keep filename rules constrained to the final path segment so unrelated parent directories are not denied accidentally.

### Protect permission messages

The permission system must not leak the data it protects. Denial and confirmation messages should identify the matched policy category or unsupported syntax without echoing complete commands, paths, environment objects, or environment values.

### Treat built-in safeguards as defense in depth

Use OMP's built-in critical-command protection as an additional safety net, not as a replacement for project policy. Avoid duplicating overlapping prompt rules because duplicate coverage increases approval fatigue and makes precedence harder to reason about. Core protected-path enforcement must also remain independent of optional command-redirection features.

### Preserve cross-environment coverage

Judge reachable execution environments, not only the host operating system. Linux-oriented destructive patterns remain relevant on Windows because an AI can execute through SSH, WSL, containers, or remote tooling.

### State the enforcement boundary

Permission rules reduce common and high-impact risks; they are not a complete Shell parser or an operating-system sandbox. Workspace isolation, filesystem permissions, and process isolation remain necessary defenses against arbitrary programs, obfuscation, and multi-stage execution.

## Current implementation

### Approval mode and built-in safety net

- `.omp/agent/config.yml` uses `tools.approvalMode: write`, not `yolo`. It auto-approves read/write tiers while requiring a prompt for the bare exec tier. In `yolo` mode, a `CRITICAL_BASH_PATTERNS` match returns no policy field, which is treated as no opinion and auto-approved; `write` mode routes that result through the override branch and prompts.
- `CRITICAL_BASH_PATTERNS` covers dangerous forms such as `rm -rf /`, `curl|bash`, `chmod -R /`, and fork bombs. It matches after user deny rules but before user prompt or allow rules.
- User prompt rules do not duplicate critical-pattern families such as broad `rm*`, `chmod*`, `chown*`, `curl|bash`, `bash <(curl...)`, or `eval "$(curl...)"`. Only narrower non-critical variants such as `rm -rf*` and `chmod -R*` remain.
- Commands containing Shell control characters such as `|`, `>`, and `$()` skip `approval: allow` rules and fall to the bare exec tier. In `write` mode this produces an additional confirmation boundary for piped and redirected commands.
- Bash patterns use first-match semantics. Deny rules precede prompt rules, and the catch-all `*` allow rule remains last. The `.env.example` allow exception precedes the broader `cat *env*` deny rule.
- Linux patterns such as `/etc/passwd`, `/dev/sd*`, and `init 0` remain configured on Windows because they are reachable through SSH, WSL, or containers.
- `bashInterceptor.enabled` defaults to `false`. Its rules redirect common Shell operations to dedicated tools only when enabled; protected-path enforcement does not depend on it.

### Protected-path authority

`.omp/extensions/permission-guard.ts` is the primary protected-path boundary. The project-level Extension listens to `tool_call`; `read`, `write`, `grep`, `edit`, and `bash` extract their supported path candidates and pass each one through the same `decisionForPath()` flow. Every filesystem policy lives in one ordered `FILE_RULES` list; the first matching rule decides that candidate. The YAML Bash patterns are supplemental defense only.

### Candidate extraction

- `read` and `write` inspect `path`.
- `grep` accepts `path` and `paths` as strings or string arrays. It splits comma-, semicolon-, and whitespace-delimited candidates while preserving delimiters inside quotes.
- `edit` inspects every valid `[PATH#TAG]` section and ignores patch content.
- `bash` checks the command's lexical fragments, its effective `cwd`, and every string value in the caller-supplied `env` object. It never reads or expands host environment variables.
- Recognized Read selectors are removed before protected-path matching. Archive, SQLite, and other selector semantics remain owned by their tools.

### Path normalization and rule ordering

- Local candidates replace Windows separators and compare case-insensitively.
- Relative candidates are checked both as provided and after prefixing the effective working directory.
- The extension intentionally does not lexically collapse `.` or `..`; protected-looking unresolved segments therefore remain conservatively denied.
- `secrets`, `.aws`, and `.ssh` match at path-segment boundaries with unrestricted suffixes. This denies `.aws-backup`, `.ssh.example`, and equivalent conservative matches. `.ss` is not protected, and unrelated `.ssl` names remain allowed.
- Filename expressions use end anchors and final-segment constraints. Protected extensions (`.env`, `.pem`, `.key`, and `.crt`) and filenames containing `credential`, `secret`, or `token` match case-insensitively without treating a parent such as `token-cache/` as a filename match.
- Protected-directory deny rules precede the `.env.example` allow exception. A basename ending in `.env.example`, regardless of case, is allowed unless an earlier rule protects its path, as with `.ssh/.env.example`. A later suffix such as `.env.example.local` remains denied.
- An allow applies only to its candidate; later candidates are still checked. Bash path candidates are checked before dynamic `SHELL_RULES`, so a literal denial takes precedence over confirmation.
- Denial and confirmation messages identify only the matched policy or unsupported syntax. They never echo a complete command, candidate path, `env` object, or environment value.

### Protocol handling

| Protocol class | Behavior |
|---|---|
| Local paths and `file://` | Convert to a filesystem path, normalize, then check |
| `ssh://` | Decode and check the remote absolute URL path; the SSH handler does not expand `~` |
| `vault://` | Decode and check the vault-relative path; the handler itself confines access to an Obsidian vault root |
| `http://`, `https://` | Skip filesystem-path policy |
| Confirmed virtual/internal URIs (`agent://`, `artifact://`, `history://`, `issue://`, `local://`, `mcp://`, `memory://`, `omp://`, `pr://`, `rule://`, `skill://`, `xd://`) | Skip filesystem-path policy |
| Unknown protocols | Deny; never default-allow |

### Shell handling

- Shell commands are not parsed by command name or argument semantics. The raw command is split on lexical Shell boundaries, and every non-empty fragment is evaluated by the same ordered `FILE_RULES` policy used by dedicated tools.
- Pipes, redirects, parentheses, brace groups, and control structures therefore cannot hide a literal protected path. The exact `.env.example` exception remains scoped to its own fragment.
- This policy is intentionally conservative. A protected-looking word can be denied even when it was intended as a search pattern, comment, or output text.
- The complete command is also checked against ordered `SHELL_RULES`; the first matching rule decides its approval.
- Variables, command substitution, unbalanced quotes, encoded commands, and nested execution that accepts a command string require confirmation. Literal denials take precedence; otherwise one confirmation is shown per tool call when UI is available, and headless calls fail closed.

### Cross-tool behavior

- YAML globs cannot reliably understand pipe and redirect combinations. The pre-hook scans raw Shell text independently of command grammar; workspace isolation and OS-level guards remain necessary for airtight enforcement.
- The YAML matcher sees command text, while the pre-hook evaluates protected-looking lexical fragments. The pre-hook remains the protected-path authority.

### Known implementation limits

- The hook is not a complete Bash, PowerShell, or cmd parser, an OS sandbox, or a replacement for filesystem permissions and process isolation.
- It does not attempt to defeat arbitrary encoding, multi-stage expansion, intentional obfuscation, or a general-purpose program that opens files itself.
- It does not inspect the returned contents of virtual or internal URIs.
- Archive, SQLite, and selector semantics remain owned by their tools; the hook only removes recognized Read selectors before checking the candidate path.

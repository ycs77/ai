/**
 * Permission Guard Extension
 *
 * Applies declarative protected-path and shell policies to guarded tool calls.
 */
import type { ExtensionAPI, ExtensionContext } from '@oh-my-pi/pi-coding-agent'
import { fileURLToPath } from 'node:url'

type Approval = 'allow' | 'deny' | 'prompt'

interface PermissionRule {
  match: RegExp
  approval: Approval
}

interface Decision {
  approval: Approval
  reason?: string
}

const GUARDED_TOOLS = ['read', 'write', 'grep', 'edit', 'bash']

const FILE_RULES: readonly PermissionRule[] = [
  { match: /(^|\/)secrets/, approval: 'deny' },
  { match: /(^|\/)\.aws/, approval: 'deny' },
  { match: /(^|\/)\.ssh/, approval: 'deny' },
  { match: /\.env\.example$/, approval: 'allow' },
  { match: /\.env$/, approval: 'deny' },
  { match: /\.env\.[^/]*$/, approval: 'deny' },
  { match: /(^|\/)appsettings\.json$/, approval: 'deny' },
  { match: /credential[^/]*$/, approval: 'deny' },
  { match: /secret[^/]*$/, approval: 'deny' },
  { match: /token[^/]*$/, approval: 'deny' },
  { match: /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/, approval: 'deny' },
  { match: /\.pem$/, approval: 'deny' },
  { match: /\.key$/, approval: 'deny' },
  { match: /\.crt$/, approval: 'deny' },
]

const ALLOWED_PROTOCOLS: Record<string, true> = {
  http: true,
  https: true,
  agent: true,
  artifact: true,
  conflict: true,
  history: true,
  issue: true,
  local: true,
  mcp: true,
  memory: true,
  omp: true,
  pr: true,
  rule: true,
  skill: true,
  xd: true,
}
const PATH_PROTOCOLS: Record<string, true> = {
  file: true,
  ssh: true,
  vault: true,
}

// Matches trailing Read selectors before protected-path checks.
// Examples:
//   .env:1-5 -> .env
//   private.key:raw -> private.key
//   app.pem:50+150 -> app.pem
//   source.ts:5-16,960-973 -> source.ts
//   .env.example:2-4:raw -> .env.example
const READ_SELECTOR_RE = /:(?:raw|conflicts|\d+(?:-\d*|\+\d+)?(?:,\d+(?:-\d*|\+\d+)?)*)$/i

// Matches a URI protocol prefix before protocol allowlist checks.
// Examples:
//   https://example.com -> https
//   file:///tmp/report.txt -> file
const PROTOCOL_RE = /^([a-z][a-z0-9+.-]*):\/\//i

// Splits shell input into literal path candidates.
// Example:
//   cat .env && echo ok -> cat, .env, echo, ok
const SHELL_SEPARATOR_RE = /[\s"'`|&;<>(){}\[\]=,]+/

// Matches only protected rm -rf targets, with an optional trailing slash.
// Windows drive mounts use /mnt/[A-Za-z] and /[A-Za-z].
// Examples:
//   /etc, /etc/, /mnt/C, /z, ~ -> match
//   /etc/hosts, /mnt/cache, /zz -> no match
const PROTECTED_RM_RF_TARGET = String.raw`(?:/(?:bin|boot|dev|etc|home|lib|lib64|mnt|mnt/[A-Za-z]|opt|proc|root|sbin|sys|usr|var|[A-Za-z])|~)/?`

// Matches rm -rf commands that delete a protected target itself.
// Supports quoted targets, an optional --, and targets after earlier operands.
// Examples:
//   rm -rf /etc -> match
//   rm -rf build "/mnt/D/" -> match
//   rm -rf /etc/cache -> no match
const PROTECTED_RM_RF_RE = new RegExp(
  String.raw`(?:^|[;&|()]\s*)rm\s+-rf\s+(?:--\s+)?(?:(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s;&|()]+)\s+)*(?:"${PROTECTED_RM_RF_TARGET}"|'${PROTECTED_RM_RF_TARGET}'|${PROTECTED_RM_RF_TARGET})(?=$|[\s;&|()])`,
  'i',
)

const SHELL_RULES: readonly PermissionRule[] = [
  // Root deletion remains in config.yml. These targets match only the listed
  // directories themselves, not their descendants.
  { match: PROTECTED_RM_RF_RE, approval: 'deny' },
  // Prompts for rm commands whose first option group starts with -r or -f.
  // Examples: rm -r build, rm -f report.txt, rm -fr cache.
  { match: /(?:^|[;&|()]\s*)rm\s+-(?:r|f)[^\s;&|()]*/i, approval: 'prompt' },
  // Detects Unix-style shell variable expansion.
  // Example: echo "$TARGET_PATH".
  { match: /\$(?:[A-Za-z0-9_?*@#$!-]|\{)/, approval: 'prompt' },
  // Detects Windows-style environment variable expansion.
  // Example: echo %TARGET_PATH%.
  { match: /%[^%\r\n]+%|![^!\r\n]+!/, approval: 'prompt' },
  // Detects command and process substitution.
  // Example: echo $(cat file.txt), echo `date`, or cat <(echo text).
  { match: /\$\(|`|[<>]\(/, approval: 'prompt' },
  // Detects dynamic shell or PowerShell expression evaluation.
  // Examples: eval "echo ok", Invoke-Expression $COMMAND.
  { match: /\b(?:eval|invoke-expression|iex)\b/i, approval: 'prompt' },
  // Detects nested POSIX shell command strings.
  // Example: bash -c "cat ordinary.txt".
  { match: /\b(?:bash|sh|zsh|fish)(?:\.exe)?\b.*\s-c\b/i, approval: 'prompt' },
  // Detects nested Windows Command Prompt command strings.
  // Examples: cmd /c type ordinary.txt, cmd /k echo ready.
  { match: /\bcmd(?:\.exe)?\b.*\/[ck]\b/i, approval: 'prompt' },
  // Detects PowerShell command and encoded-command arguments.
  // Example: pwsh -Command Get-Content ordinary.txt.
  { match: /\b(?:powershell|pwsh)(?:\.exe)?\b.*-(?:c|command|encodedcommand)\b/i, approval: 'prompt' },
  // Detects inline programs passed to common scripting runtimes.
  // Examples: node -e "console.log('ok')", python -c "print('ok')".
  { match: /\b(?:node|python|python3|ruby|perl)(?:\.exe)?\b.*-(?:e|c)\b/i, approval: 'prompt' },
  // Detects certutil payload decoding.
  // Example: certutil -decode payload.txt output.txt.
  { match: /\bcertutil(?:\.exe)?\b.*\bdecode\b/i, approval: 'prompt' },
  // Detects base64 payload decoding.
  // Examples: base64 -d payload.txt, base64 --decode payload.txt.
  { match: /\bbase64(?:\.exe)?\b.*(?:-d\b|--decode\b)/i, approval: 'prompt' },
  // Detects OpenSSL base64 payload decoding.
  // Example: openssl base64 -d -in payload.txt.
  { match: /\bopenssl(?:\.exe)?\b.*\bbase64\b.*(?:-d\b|-decode\b)/i, approval: 'prompt' },
]

function matchingRule(
  value: string,
  rules: readonly PermissionRule[],
): PermissionRule | undefined {
  for (const rule of rules) {
    if (rule.match.test(value)) return rule
  }
}

function stripReadSelectors(value: string): string {
  let candidate = value
  while (READ_SELECTOR_RE.test(candidate)) {
    candidate = candidate.replace(READ_SELECTOR_RE, '')
  }
  return candidate
}

function normalizePath(pathLike: string): string {
  return pathLike.replace(/\\/g, '/').toLowerCase()
}

function resolvePath(pathLike: string, cwd: string): string {
  const normalized = normalizePath(pathLike)
  if (/^(?:[a-z]:\/|\/)/i.test(normalized)) return normalized
  return `${normalizePath(cwd)}/${normalized}`
}

function decisionForPath(pathLike: string, cwd: string): Decision {
  let candidate = pathLike.trim()
  if (!candidate) return { approval: 'allow' }

  const protocol = candidate.match(PROTOCOL_RE)?.[1].toLowerCase()
  if (protocol) {
    if (ALLOWED_PROTOCOLS[protocol] === true) return { approval: 'allow' }
    if (PATH_PROTOCOLS[protocol] !== true) {
      return { approval: 'deny', reason: 'unsupported path protocol' }
    }

    try {
      candidate = protocol === 'file'
        ? fileURLToPath(candidate)
        : decodeURIComponent(new URL(candidate).pathname)
    } catch {
      return { approval: 'deny', reason: 'invalid path protocol' }
    }
  }

  const normalized = normalizePath(candidate)
  const candidates = protocol ? [normalized] : [normalized, resolvePath(normalized, cwd)]

  for (const path of candidates) {
    const rule = matchingRule(path.replace(/\/+$/, ''), FILE_RULES)
    if (!rule || rule.approval === 'allow') continue
    return {
      approval: rule.approval,
      reason: `protected-path pattern ${rule.match.source}`,
    }
  }
  return { approval: 'allow' }
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function editPaths(input: string): string[] {
  const paths: string[] = []
  const pattern = /^\[([^\]#]+)#[0-9A-F]{4}\]/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) paths.push(match[1].trim())
  return paths
}

function splitDelimitedPaths(value: string): string[] {
  const paths: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (/[\s,;]/.test(char)) {
      if (current) paths.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) paths.push(current)
  return paths
}

function toolPaths(tool: string, input: unknown): string[] {
  if (typeof input === 'string') {
    return tool === 'edit' ? editPaths(input) : [input]
  }
  if (!input || typeof input !== 'object') return []

  const fields = input as Record<string, unknown>
  if (tool === 'read' || tool === 'write') return stringValues(fields.path)
  if (tool === 'grep') {
    return [...stringValues(fields.path), ...stringValues(fields.paths)]
      .flatMap(splitDelimitedPaths)
  }
  if (tool === 'edit') {
    return editPaths(typeof fields.input === 'string' ? fields.input : '')
  }
  return []
}

async function enforce(
  tool: string,
  decision: Decision,
  context: ExtensionContext,
) {
  if (decision.approval === 'allow') return

  const denied = {
    block: true,
    reason: `Permission denied: ${decision.reason ?? 'protected path'}.`,
  }
  if (decision.approval === 'deny' || !context.hasUI) return denied

  const lines = [`Allow tool: ${tool}`]

  if (decision.reason) {
    lines.push(`Reason: ${decision.reason}`)
  }

  const choice = await context.ui.select(
    lines.join('\n'),
    ['Approve', 'Deny'],
  )
  return choice === 'Approve' ? undefined : denied
}

async function checkPaths(
  tool: string,
  paths: string[],
  cwd: string,
  context: ExtensionContext,
) {
  for (const path of paths) {
    const result = await enforce(tool, decisionForPath(path, cwd), context)
    if (result) return result
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, context) => {
    const tool = event.toolName
    if (!GUARDED_TOOLS.includes(tool)) return

    const input = event.input
    const fields = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : {}

    if (tool !== 'bash') {
      const paths = toolPaths(tool, input)
      return checkPaths(
        tool,
        tool === 'read' ? paths.map(stripReadSelectors) : paths,
        context.cwd,
        context,
      )
    }

    const command = typeof fields.command === 'string' ? fields.command : ''
    const rawCwd = typeof fields.cwd === 'string' ? fields.cwd : context.cwd
    const cwd = resolvePath(rawCwd, context.cwd)
    const env = fields.env && typeof fields.env === 'object' && !Array.isArray(fields.env)
      ? Object.values(fields.env).filter((value): value is string => typeof value === 'string')
      : []
    const paths = [
      rawCwd,
      ...env,
      ...command.split(SHELL_SEPARATOR_RE).filter(Boolean),
    ]

    const blocked = await checkPaths(tool, paths, cwd, context)
    if (blocked) return blocked
    const shellRule = matchingRule(command, SHELL_RULES)
    if (shellRule) {
      return enforce(tool, {
        approval: shellRule.approval,
        reason: `shell pattern ${shellRule.match.source}`,
      }, context)
    }
  })
}

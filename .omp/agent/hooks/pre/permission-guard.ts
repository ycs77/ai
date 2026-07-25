/**
 * Permission Guard Hook (PreToolUse)
 *
 * Applies one protected-path policy to dedicated filesystem tools and Bash.
 * Candidate files are never opened while evaluating the policy.
 */

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookAPI } from '@oh-my-pi/pi-coding-agent/extensibility/hooks'

type Approval = 'allow' | 'deny' | 'prompt'

interface FileRule {
  name: string
  match: RegExp
  approval: Approval
}

const FILE_RULES: readonly FileRule[] = [
  {
    name: 'secrets/ directory',
    match: /(^|\/)secrets/i,
    approval: 'deny',
  },
  {
    name: '.aws/ directory',
    match: /(^|\/)\.aws/i,
    approval: 'deny',
  },
  {
    name: '.ssh/ directory',
    match: /(^|\/)\.ssh/i,
    approval: 'deny',
  },
  {
    name: '.env.example exception',
    match: /(^|\/)\.env\.example$/i,
    approval: 'allow',
  },
  {
    name: '.env file (*.env)',
    match: /\.env$/i,
    approval: 'deny',
  },
  {
    name: '.env.* file (*.env.*)',
    match: /\.env\.[^/]*$/i,
    approval: 'deny',
  },
  {
    name: 'appsettings.json',
    match: /(^|\/)appsettings\.json$/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'credential'",
    match: /credential[^/]*$/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'secret'",
    match: /secret[^/]*$/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'token'",
    match: /token[^/]*$/i,
    approval: 'deny',
  },
  {
    name: 'SSH private key',
    match: /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
    approval: 'deny',
  },
  {
    name: '.pem file',
    match: /\.pem$/i,
    approval: 'deny',
  },
  {
    name: '.key file',
    match: /\.key$/i,
    approval: 'deny',
  },
  {
    name: '.crt file',
    match: /\.crt$/i,
    approval: 'deny',
  },
]

const SCHEME_PATH_CHECKS: Record<string, boolean> = {
  http: false,
  https: false,
  file: true,
  ssh: true,
  vault: true,
  agent: false,
  artifact: false,
  conflict: false,
  history: false,
  issue: false,
  local: false,
  mcp: false,
  memory: false,
  omp: false,
  pr: false,
  rule: false,
  skill: false,
  xd: false,
}

// Splits raw Shell text at lexical boundaries before checking each literal fragment as a path.
// Example match: spaces, quotes, and `&&` in `cat ".env" && echo ok`.
const SHELL_CANDIDATE_SEPARATOR_RE = /[\s"'`|&;<>(){}\[\]=,]+/

// Detects command forms that execute or decode content that static path scanning cannot safely resolve.
// Example match: `bash -c "cat ordinary.txt"`.
const UNSUPPORTED_SHELL_EXECUTION_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s"'|&;(){}])(?:eval|invoke-expression|iex)(?=$|[\s"'|&;(){}])/i,
  /(?:^|[\s"'|&;(){}])(?:[^\s"'|&;(){}]*[/\\])?(?:bash|sh|zsh|fish)(?:\.exe)?["']?(?:\s+[^\s|&;]+)*\s+-c(?=$|[\s"'|&;(){}])/i,
  /(?:^|[\s"'|&;(){}])(?:[^\s"'|&;(){}]*[/\\])?cmd(?:\.exe)?["']?(?:\s+[^\s|&;]+)*\s+\/[ck](?=$|[\s"'|&;(){}])/i,
  /(?:^|[\s"'|&;(){}])(?:[^\s"'|&;(){}]*[/\\])?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+[^\s|&;]+)*\s+-(?:c|command|encodedcommand)(?=$|[\s"'|&;(){}])/i,
  /(?:^|[\s"'|&;(){}])(?:[^\s"'|&;(){}]*[/\\])?(?:node|python|python3|ruby|perl)(?:\.exe)?["']?(?:\s+[^\s|&;]+)*\s+-(?:e|c)(?=$|[\s"'|&;(){}])/i,
  /(?:^|[\s"'|&;(){}])certutil(?:\.exe)?\b[^|&;\r\n]*\bdecode\b/i,
  /(?:^|[\s"'|&;(){}])base64(?:\.exe)?\b[^|&;\r\n]*(?:^|\s)(?:-d|--decode)(?=$|\s)/i,
  /(?:^|[\s"'|&;(){}])openssl(?:\.exe)?\b[^|&;\r\n]*\bbase64\b[^|&;\r\n]*(?:^|\s)(?:-d|-decode)(?=$|\s)/i,
]

const PROTOCOL_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const READ_SELECTOR_RE = /:(?:raw|conflicts|L?\d+(?:(?:[-+]|\.\.)L?\d+|-|\.\.)?(?:,L?\d+(?:(?:[-+]|\.\.)L?\d+|-|\.\.)?)*)$/i

interface PathDecision {
  approval: Approval
  reason?: string
  promptTitle?: string
  promptMessage?: string
}

interface ConfirmationContext {
  hasUI: boolean
  ui: {
    confirm: (title: string, message: string) => Promise<boolean>
  }
}

function allowPath(): PathDecision {
  return { approval: 'allow' }
}

function denyPath(reason: string): PathDecision {
  return { approval: 'deny', reason }
}

function stripOuterQuotes(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  if ((first === "'" || first === '"') && value.at(-1) === first) {
    return value.slice(1, -1)
  }
  return value
}

function stripReadSelectors(value: string): string {
  let candidate = value
  while (READ_SELECTOR_RE.test(candidate)) {
    candidate = candidate.replace(READ_SELECTOR_RE, '')
  }
  return candidate
}

function normalizePathSeparators(pathLike: string): string {
  return pathLike.replace(/\\/g, '/')
}

function usesWindowsPathSemantics(pathLike: string): boolean {
  const normalized = normalizePathSeparators(pathLike)
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
}


function normalizePathLike(pathLike: string): string {
  const normalized = normalizePathSeparators(pathLike)
  const implementation = usesWindowsPathSemantics(normalized) ? path.win32 : path.posix
  return normalizePathSeparators(implementation.normalize(normalized))
}

function resolvePathLike(cwd: string, pathLike: string): string {
  const normalizedCwd = normalizePathSeparators(cwd)
  const normalizedPath = normalizePathSeparators(pathLike)
  const implementation = usesWindowsPathSemantics(normalizedCwd) ? path.win32 : path.posix
  return normalizePathSeparators(implementation.resolve(normalizedCwd, normalizedPath))
}

function matchingFileRule(pathLike: string): FileRule | undefined {
  const normalized = normalizePathSeparators(pathLike).replace(/\/+$/, '')
  return FILE_RULES.find((rule) => rule.match.test(normalized))
}

function normalizedPathCandidates(rawPath: string, cwd?: string): string[] {
  const comparisonPaths: string[] = []
  const add = (candidate: string) => {
    if (!comparisonPaths.includes(candidate)) comparisonPaths.push(candidate)
  }

  const separatorNormalized = normalizePathSeparators(rawPath)
  const lexicalNormalized = normalizePathLike(separatorNormalized)
  add(separatorNormalized)
  add(lexicalNormalized)

  const isAbsolute = usesWindowsPathSemantics(separatorNormalized) ||
    separatorNormalized.startsWith('/')
  if (cwd && !isAbsolute) {
    add(resolvePathLike(cwd, separatorNormalized))
    add(normalizePathLike(cwd))
  }

  return comparisonPaths
}

export function protectedPathReason(pathLike: string): string | undefined {
  const rule = matchingFileRule(pathLike)
  return rule?.approval === 'deny' ? rule.name : undefined
}


function decodeProtocolPath(rawPath: string, scheme: string): string | PathDecision {
  try {
    if (scheme === 'file') return fileURLToPath(rawPath)

    const url = new URL(rawPath)
    return decodeURIComponent(url.pathname)
  } catch {
    return denyPath('invalid protected-path protocol input')
  }
}

/** Checks one candidate without reading it. */
function checkPath(rawPath: string, cwd?: string): PathDecision {
  if (!rawPath.trim()) return allowPath()

  let candidate = stripReadSelectors(stripOuterQuotes(rawPath.trim()))
  let resolutionCwd = cwd
  const protocol = candidate.match(PROTOCOL_RE)

  if (protocol) {
    const scheme = protocol[1].toLowerCase()
    const shouldCheckPath = SCHEME_PATH_CHECKS[scheme]
    if (shouldCheckPath === undefined) return denyPath('unsupported path protocol')
    if (!shouldCheckPath) return allowPath()

    const decoded = decodeProtocolPath(candidate, scheme)
    if (typeof decoded !== 'string') return decoded
    candidate = decoded
    resolutionCwd = undefined
  }

  let promptDecision: PathDecision | undefined
  for (const comparisonPath of normalizedPathCandidates(candidate, resolutionCwd)) {
    const rule = matchingFileRule(comparisonPath)
    if (!rule || rule.approval === 'allow') continue

    const decision: PathDecision = {
      approval: rule.approval,
      reason: rule.name,
    }
    if (decision.approval === 'deny') return decision
    promptDecision ??= decision
  }
  return promptDecision ?? allowPath()
}

/** Extracts file paths from edit tool input by parsing [PATH#TAG] headers. */
function extractEditPaths(input: string): string[] {
  const paths: string[] = []
  const re = /^\[([^\]#]+)#[0-9A-F]{4}\]/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) paths.push(match[1].trim())
  return paths
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function splitDelimitedPaths(value: string): string[] {
  const paths: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null

  const flush = () => {
    const candidate = stripOuterQuotes(current.trim())
    if (candidate) paths.push(candidate)
    current = ''
  }

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ',' || char === ';' || /\s/.test(char)) flush()
    else current += char
  }
  flush()
  return paths
}

function dedicatedToolPaths(tool: string, input: Record<string, unknown> | string): string[] {
  if (tool === 'edit') {
    const text = typeof input === 'string' ? input : String(input.input ?? '')
    return extractEditPaths(text)
  }

  const values = typeof input === 'string'
    ? [input]
    : [...stringValues(input.path), ...stringValues(input.paths)]
  if (tool !== 'grep') return values

  const candidates: string[] = []
  for (const value of values) {
    for (const candidate of [value, ...splitDelimitedPaths(value)]) {
      if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
    }
  }
  return candidates
}


function hasUnsupportedDynamicShellSyntax(command: string): boolean {
  let quote: "'" | '"' | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }

    if (char === quote) {
      quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '$' && /[({A-Za-z0-9_?*@#-]/.test(next ?? '')) return true
    if (char === '`') return true
    if ((char === '<' || char === '>') && next === '(') return true
    if (char === '\\' && (next === '\n' || next === '\r' || next === undefined)) return true
  }

  if (quote) return true
  if (/%[^%\r\n]+%/.test(command) || /![^!\r\n]+!/.test(command) || command.includes('--%')) {
    return true
  }
  return UNSUPPORTED_SHELL_EXECUTION_PATTERNS.some(pattern => pattern.test(command))
}

function denial(decision: PathDecision) {
  return {
    block: true,
    reason: `Permission denied: ${decision.reason ?? 'protected path'}.`,
  }
}

function evaluatePathRules(candidates: string[], cwd?: string): PathDecision[] {
  const decisions: PathDecision[] = []
  for (const candidate of candidates) decisions.push(checkPath(candidate, cwd))
  return decisions
}

async function enforceApprovals(
  decisions: PathDecision[],
  context: ConfirmationContext,
) {
  const denied = decisions.find(decision => decision.approval === 'deny')
  if (denied) return denial(denied)

  const prompted = decisions.find(decision => decision.approval === 'prompt')
  if (!prompted) return undefined
  if (!context.hasUI) return denial(prompted)

  const confirmed = await context.ui.confirm(
    prompted.promptTitle ?? 'Protected path access',
    prompted.promptMessage ??
      'This operation matches a protected-path prompt rule. Allow it to continue?',
  )
  return confirmed ? undefined : denial(prompted)
}

function effectiveShellCwd(input: Record<string, unknown>, contextCwd: string): string {
  const raw = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : contextCwd
  if (PROTOCOL_RE.test(raw)) return contextCwd

  const normalized = normalizePathSeparators(raw)
  const isAbsolute = usesWindowsPathSemantics(normalized) || normalized.startsWith('/')
  return isAbsolute ? normalizePathLike(normalized) : resolvePathLike(contextCwd, normalized)
}

export default function (pi: HookAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    const tool = event.toolName
    const rawInput = event.input ?? {}
    const input = typeof rawInput === 'object' && rawInput !== null
      ? rawInput as Record<string, unknown>
      : String(rawInput)

    if (tool === 'read' || tool === 'write' || tool === 'grep' || tool === 'edit') {
      return enforceApprovals(
        evaluatePathRules(dedicatedToolPaths(tool, input), ctx.cwd),
        ctx,
      )
    }

    if (tool !== 'bash' || typeof input === 'string') return

    const command = String(input.command ?? '')
    const cwdCandidate = typeof input.cwd === 'string' ? input.cwd : ctx.cwd
    const effectiveCwd = effectiveShellCwd(input, ctx.cwd)
    const envCandidates = input.env && typeof input.env === 'object' && !Array.isArray(input.env)
      ? Object.values(input.env).filter((value): value is string => typeof value === 'string')
      : []

    const uncertain = hasUnsupportedDynamicShellSyntax(command)
    const decisions = [
      ...evaluatePathRules([cwdCandidate], ctx.cwd),
      ...evaluatePathRules(envCandidates, effectiveCwd),
      ...evaluatePathRules(
        command.split(SHELL_CANDIDATE_SEPARATOR_RE).filter(Boolean),
        effectiveCwd,
      ),
    ]
    if (uncertain) {
      decisions.push({
        approval: 'prompt',
        reason: 'unsupported dynamic shell syntax',
        promptTitle: 'Unsupported dynamic shell syntax',
        promptMessage: 'This command contains unsupported dynamic shell syntax. Allow it to run?',
      })
    }

    return enforceApprovals(decisions, ctx)
  })
}

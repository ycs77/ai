/**
 * Permission Guard Hook (PreToolUse)
 *
 * Applies one protected-path policy to dedicated filesystem tools and Bash.
 * Candidate files are never opened while evaluating the policy.
 */

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookAPI } from '@oh-my-pi/pi-coding-agent/extensibility/hooks'

// Permission policy

type Approval = 'allow' | 'deny' | 'prompt'
type RuleTarget = 'basename' | 'path'
type ShellPathStrategy = 'all-positional' | 'grep' | 'sed' | 'powershell'

interface FileRule {
  name: string
  target: RuleTarget
  match: RegExp
  approval: Approval
}

interface ShellCommandRule {
  pathStrategy: ShellPathStrategy
  positionalLimit?: number
}

interface ShellWrapperRule {
  valueOptions: Readonly<Record<string, boolean>>
}

type ArgumentCondition =
  | { kind: 'equals-any'; values: readonly string[] }
  | { kind: 'includes-any'; values: readonly string[] }

interface UnsupportedExecutionRule {
  commands: readonly string[]
  all: readonly ArgumentCondition[]
}

const FILE_RULES: readonly FileRule[] = [
  {
    name: 'secrets/ directory',
    target: 'path',
    match: /(^|[/\\])secrets/i,
    approval: 'deny',
  },
  {
    name: '.aws/ directory',
    target: 'path',
    match: /(^|[/\\])\.aws/i,
    approval: 'deny',
  },
  {
    name: '.ssh/ directory',
    target: 'path',
    match: /(^|[/\\])\.ssh/i,
    approval: 'deny',
  },
  {
    name: '.ss/ directory',
    target: 'path',
    match: /(^|[/\\])\.ss/i,
    approval: 'deny',
  },
  {
    name: '.env.example exception',
    target: 'basename',
    match: /^\.env\.example$/i,
    approval: 'allow',
  },
  {
    name: '.env file (*.env)',
    target: 'basename',
    match: /\.env$/i,
    approval: 'deny',
  },
  {
    name: '.env.* file (*.env.*)',
    target: 'basename',
    match: /\.env\./i,
    approval: 'deny',
  },
  {
    name: 'appsettings.json',
    target: 'basename',
    match: /^appsettings\.json$/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'credential'",
    target: 'basename',
    match: /credential/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'secret'",
    target: 'basename',
    match: /secret/i,
    approval: 'deny',
  },
  {
    name: "filename contains 'token'",
    target: 'basename',
    match: /token/i,
    approval: 'deny',
  },
  {
    name: 'SSH private key',
    target: 'basename',
    match: /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
    approval: 'deny',
  },
  {
    name: '.pem file',
    target: 'basename',
    match: /\.pem$/i,
    approval: 'deny',
  },
  {
    name: '.key file',
    target: 'basename',
    match: /\.key$/i,
    approval: 'deny',
  },
  {
    name: '.crt file',
    target: 'basename',
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

const POWERSHELL_PATH_OPTIONS: Record<string, boolean> = {
  path: true,
  literalpath: true,
  filepath: true,
  destination: true,
}

const POWERSHELL_VALUE_OPTIONS: Record<string, boolean> = {
  value: true,
  encoding: true,
  filter: true,
  include: true,
  exclude: true,
}

const SHELL_COMMAND_WRAPPERS: Record<string, ShellWrapperRule> = {
  sudo: {
    valueOptions: {
      '-u': true,
      '--user': true,
      '-g': true,
      '--group': true,
      '-h': true,
      '--host': true,
      '-p': true,
      '--prompt': true,
      '-C': true,
      '--close-from': true,
      '-R': true,
      '--chroot': true,
      '-D': true,
      '--chdir': true,
      '-T': true,
      '--command-timeout': true,
    },
  },
  command: { valueOptions: {} },
  builtin: { valueOptions: {} },
}

const SHELL_COMMAND_RULES: Record<string, ShellCommandRule> = {
  cat: { pathStrategy: 'all-positional' },
  tee: { pathStrategy: 'all-positional' },
  cp: { pathStrategy: 'all-positional' },
  mv: { pathStrategy: 'all-positional' },
  rm: { pathStrategy: 'all-positional' },
  type: { pathStrategy: 'all-positional' },
  copy: { pathStrategy: 'all-positional' },
  move: { pathStrategy: 'all-positional' },
  del: { pathStrategy: 'all-positional' },
  erase: { pathStrategy: 'all-positional' },
  grep: { pathStrategy: 'grep' },
  rg: { pathStrategy: 'grep' },
  ripgrep: { pathStrategy: 'grep' },
  sed: { pathStrategy: 'sed' },
  'get-content': { pathStrategy: 'powershell', positionalLimit: 1 },
  'set-content': { pathStrategy: 'powershell', positionalLimit: 1 },
  'out-file': { pathStrategy: 'powershell', positionalLimit: 1 },
  'copy-item': { pathStrategy: 'powershell', positionalLimit: 2 },
  'remove-item': { pathStrategy: 'powershell', positionalLimit: 1 },
}

const UNSUPPORTED_EXECUTION_RULES: readonly UnsupportedExecutionRule[] = [
  {
    commands: ['eval', 'invoke-expression', 'iex'],
    all: [],
  },
  {
    commands: ['bash', 'sh', 'zsh', 'fish'],
    all: [{ kind: 'equals-any', values: ['-c'] }],
  },
  {
    commands: ['cmd'],
    all: [{ kind: 'equals-any', values: ['/c', '/k'] }],
  },
  {
    commands: ['powershell', 'pwsh'],
    all: [{ kind: 'equals-any', values: ['-c', '-command', '-encodedcommand'] }],
  },
  {
    commands: ['node', 'python', 'python3', 'ruby', 'perl'],
    all: [{ kind: 'equals-any', values: ['-e', '-c'] }],
  },
  {
    commands: ['certutil'],
    all: [{ kind: 'includes-any', values: ['decode'] }],
  },
  {
    commands: ['base64'],
    all: [{ kind: 'equals-any', values: ['-d', '--decode'] }],
  },
  {
    commands: ['openssl'],
    all: [
      { kind: 'equals-any', values: ['base64'] },
      { kind: 'equals-any', values: ['-d', '-decode'] },
    ],
  },
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

interface ShellToken {
  kind: 'word' | 'control' | 'redirect'
  value: string
}

interface ShellParseResult {
  tokens: ShellToken[]
  uncertain: boolean
}

interface CommandInvocation {
  command: string
  args: string[]
  assignmentValues: string[]
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

function basename(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
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
  let originalPath: string | undefined
  let relativeCwd: string | undefined
  const protocol = candidate.match(PROTOCOL_RE)

  if (protocol) {
    const scheme = protocol[1].toLowerCase()
    const shouldCheckPath = SCHEME_PATH_CHECKS[scheme]
    if (shouldCheckPath === undefined) return denyPath('unsupported path protocol')
    if (!shouldCheckPath) return allowPath()

    const decoded = decodeProtocolPath(candidate, scheme)
    if (typeof decoded !== 'string') return decoded
    candidate = decoded
  } else {
    originalPath = candidate.replace(/\\/g, '/')
    if (cwd && !path.isAbsolute(candidate)) {
      relativeCwd = cwd.replace(/\\/g, '/')
      candidate = path.resolve(cwd, candidate)
    }
  }

  const normalized = candidate.replace(/\\/g, '/')
  const comparisonPaths = [normalized]
  if (originalPath && originalPath !== normalized) comparisonPaths.push(originalPath)
  if (relativeCwd && relativeCwd !== normalized) comparisonPaths.push(relativeCwd)
  const base = basename(normalized)

  for (const rule of FILE_RULES) {
    const matched = rule.target === 'basename'
      ? rule.match.test(base)
      : comparisonPaths.some(value => rule.match.test(value))
    if (!matched) continue
    return {
      approval: rule.approval,
      reason: rule.approval === 'allow' ? undefined : rule.name,
    }
  }
  return allowPath()
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
    if (char === ',' || char === ';') flush()
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

  if (typeof input === 'string') return [input]

  const candidates = [...stringValues(input.path)]
  if (tool === 'grep') {
    for (const value of stringValues(input.paths)) candidates.push(...splitDelimitedPaths(value))
  } else {
    candidates.push(...stringValues(input.paths))
  }
  return candidates
}

function tokenizeShell(command: string): ShellParseResult {
  const tokens: ShellToken[] = []
  let current = ''
  let wordStarted = false
  let quote: "'" | '"' | null = null
  let uncertain = false

  const flushWord = () => {
    if (wordStarted) tokens.push({ kind: 'word', value: current })
    current = ''
    wordStarted = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }
      if (quote === '"' && char === '$' && /[({A-Za-z0-9_?*@#-]/.test(next ?? '')) {
        uncertain = true
      }
      if (quote === '"' && char === '`') uncertain = true
      current += char
      wordStarted = true
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      wordStarted = true
      continue
    }

    if (char === '$' && /[({A-Za-z0-9_?*@#-]/.test(next ?? '')) uncertain = true
    if (char === '`') uncertain = true
    if ((char === '<' || char === '>') && next === '(') uncertain = true
    if (char === '\\' && (next === '\n' || next === '\r' || next === undefined)) uncertain = true

    if (/\s/.test(char)) {
      flushWord()
      if (char === '\n' || char === '\r') tokens.push({ kind: 'control', value: ';' })
      continue
    }

    if (char === '#' && !wordStarted) {
      while (index + 1 < command.length && !/[\r\n]/.test(command[index + 1])) index += 1
      continue
    }

    if (char === '|' || char === '&' || char === ';') {
      flushWord()
      const doubled = next === char && char !== ';'
      tokens.push({ kind: 'control', value: doubled ? char + next : char })
      if (doubled) index += 1
      continue
    }

    if (char === '>' || char === '<') {
      if (/^\d+$/.test(current)) {
        current = ''
        wordStarted = false
      } else {
        flushWord()
      }
      const doubled = next === char
      tokens.push({ kind: 'redirect', value: doubled ? char + next : char })
      if (doubled) index += 1
      continue
    }

    if (char === '\\' && next && /[\s'"|&;<>\\]/.test(next)) {
      current += next
      wordStarted = true
      index += 1
      continue
    }

    current += char
    wordStarted = true
  }

  flushWord()
  if (quote) uncertain = true
  if (/%[^%\r\n]+%/.test(command) || /![^!\r\n]+!/.test(command) || command.includes('--%')) {
    uncertain = true
  }

  return { tokens, uncertain }
}

function executableName(value: string): string {
  const name = value.replace(/\\/g, '/').slice(value.replace(/\\/g, '/').lastIndexOf('/') + 1)
  return name.toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/i, '')
}

function commandSegments(tokens: ShellToken[]): ShellToken[][] {
  const segments: ShellToken[][] = []
  let current: ShellToken[] = []
  for (const token of tokens) {
    if (token.kind === 'control') {
      if (current.length) segments.push(current)
      current = []
    } else {
      current.push(token)
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function wordsWithoutRedirects(segment: ShellToken[], redirectedPaths: string[]): string[] {
  const words: string[] = []
  for (let index = 0; index < segment.length; index += 1) {
    const token = segment[index]
    if (token.kind === 'redirect') {
      const target = segment[index + 1]
      if (target?.kind === 'word') {
        redirectedPaths.push(target.value)
        index += 1
      }
      continue
    }
    if (token.kind === 'word') words.push(token.value)
  }
  return words
}

function resolveCommandInvocation(words: string[]): CommandInvocation {
  const assignmentValues: string[] = []
  let commandIndex = 0

  while (commandIndex < words.length) {
    const word = words[commandIndex]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      assignmentValues.push(word.slice(word.indexOf('=') + 1))
      commandIndex += 1
      continue
    }

    const wrapper = SHELL_COMMAND_WRAPPERS[executableName(word)]
    if (!wrapper) break
    commandIndex += 1

    while (words[commandIndex]?.startsWith('-')) {
      const option = words[commandIndex]
      commandIndex += 1
      if (option === '--') break

      const rawOptionName = option.split(/[=:]/, 1)[0]
      const optionName = rawOptionName.startsWith('--')
        ? rawOptionName.toLowerCase()
        : rawOptionName
      const hasInlineValue = option.includes('=') || option.includes(':')
      if (wrapper.valueOptions[optionName] && !hasInlineValue && words[commandIndex]) {
        commandIndex += 1
      }
    }
  }

  return {
    command: executableName(words[commandIndex] ?? ''),
    args: words.slice(commandIndex + 1),
    assignmentValues,
  }
}

function optionValue(option: string): string | undefined {
  const match = option.match(/^-[A-Za-z][A-Za-z-]*(?:=|:)(.+)$/)
  return match?.[1]
}

function grepPaths(args: string[]): string[] {
  const paths: string[] = []
  let patternProvided = false
  let optionsEnded = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && (arg === '-e' || arg === '--regexp')) {
      patternProvided = true
      index += 1
      continue
    }
    if (!optionsEnded && (arg.startsWith('-e') || arg.startsWith('--regexp='))) {
      patternProvided = true
      continue
    }
    if (!optionsEnded && (arg === '-f' || arg === '--file')) {
      if (args[index + 1]) paths.push(args[index + 1])
      patternProvided = true
      index += 1
      continue
    }
    if (!optionsEnded && (arg.startsWith('-f') || arg.startsWith('--file='))) {
      const value = arg.startsWith('--') ? optionValue(arg) : arg.slice(2)
      if (value) paths.push(value)
      patternProvided = true
      continue
    }
    if (!optionsEnded && /^-(?:A|B|C|m|max-count|include|exclude|exclude-from|include-from)$/.test(arg)) {
      index += 1
      continue
    }
    if (!optionsEnded && arg.startsWith('-')) continue
    if (!patternProvided) patternProvided = true
    else paths.push(arg)
  }
  return paths
}

function sedPaths(args: string[]): string[] {
  const paths: string[] = []
  let scriptProvided = false
  let optionsEnded = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && (arg === '-e' || arg === '--expression')) {
      scriptProvided = true
      index += 1
      continue
    }
    if (!optionsEnded && (arg.startsWith('-e') || arg.startsWith('--expression='))) {
      scriptProvided = true
      continue
    }
    if (!optionsEnded && (arg === '-f' || arg === '--file')) {
      if (args[index + 1]) paths.push(args[index + 1])
      scriptProvided = true
      index += 1
      continue
    }
    if (!optionsEnded && (arg.startsWith('-f') || arg.startsWith('--file='))) {
      const value = arg.startsWith('--') ? optionValue(arg) : arg.slice(2)
      if (value) paths.push(value)
      scriptProvided = true
      continue
    }
    if (!optionsEnded && arg.startsWith('-')) continue
    if (!scriptProvided) scriptProvided = true
    else paths.push(arg)
  }
  return paths
}

function powershellPaths(positionalLimit: number, args: string[]): string[] {
  const paths: string[] = []
  let positionalCount = 0

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const inline = arg.match(/^-([A-Za-z-]+)(?:=|:)(.+)$/)
    if (inline) {
      if (POWERSHELL_PATH_OPTIONS[inline[1].toLowerCase()]) paths.push(...splitDelimitedPaths(inline[2]))
      continue
    }
    const option = arg.match(/^-([A-Za-z-]+)$/)
    if (option) {
      const name = option[1].toLowerCase()
      if (POWERSHELL_PATH_OPTIONS[name] && args[index + 1]) {
        paths.push(...splitDelimitedPaths(args[index + 1]))
        index += 1
      } else if (POWERSHELL_VALUE_OPTIONS[name]) {
        index += 1
      }
      continue
    }
    if (positionalCount < positionalLimit) {
      paths.push(...splitDelimitedPaths(arg))
      positionalCount += 1
    }
  }
  return paths
}

function directCommandPaths(tokens: ShellToken[]): string[] {
  const paths: string[] = []

  for (const segment of commandSegments(tokens)) {
    const words = wordsWithoutRedirects(segment, paths)
    if (!words.length) continue

    const invocation = resolveCommandInvocation(words)
    paths.push(...invocation.assignmentValues)

    const rule = SHELL_COMMAND_RULES[invocation.command]
    if (!rule) continue

    if (rule.pathStrategy === 'all-positional') {
      paths.push(...invocation.args.filter(arg => !arg.startsWith('-')))
    } else if (rule.pathStrategy === 'grep') {
      paths.push(...grepPaths(invocation.args))
    } else if (rule.pathStrategy === 'sed') {
      paths.push(...sedPaths(invocation.args))
    } else {
      paths.push(...powershellPaths(rule.positionalLimit ?? 1, invocation.args))
    }
  }

  return paths
}


function hasUnsupportedExecution(tokens: ShellToken[]): boolean {
  for (const segment of commandSegments(tokens)) {
    const words = wordsWithoutRedirects(segment, [])
    if (!words.length) continue

    const invocation = resolveCommandInvocation(words)
    const command = invocation.command
    const args = invocation.args.map(value => value.toLowerCase())
    const unsupported = UNSUPPORTED_EXECUTION_RULES.some(rule =>
      rule.commands.includes(command) &&
      rule.all.every(condition =>
        condition.kind === 'equals-any'
          ? args.some(arg => condition.values.includes(arg))
          : args.some(arg => condition.values.some(value => arg.includes(value))),
      ),
    )
    if (unsupported) return true
  }
  return false
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
  return path.isAbsolute(raw) ? raw : path.resolve(contextCwd, raw)
}

// Hook registration

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

    const parsed = tokenizeShell(command)
    const directCandidates = directCommandPaths(parsed.tokens)
    const uncertain = parsed.uncertain || hasUnsupportedExecution(parsed.tokens)
    const literalWords = uncertain
      ? parsed.tokens.filter(token => token.kind === 'word').map(token => token.value)
      : []

    const decisions = [
      ...evaluatePathRules([cwdCandidate], ctx.cwd),
      ...evaluatePathRules(envCandidates, effectiveCwd),
      ...evaluatePathRules(directCandidates, effectiveCwd),
      ...evaluatePathRules(literalWords, effectiveCwd),
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

import assert from 'node:assert/strict'
import test from 'node:test'

import registerPermissionGuard from './permission-guard.ts'

type ToolInput = Record<string, unknown> | string

type HookContext = {
  cwd: string
  hasUI: boolean
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>
  }
}

type HookResult = { block?: boolean; reason?: string } | undefined

type Handler = (
  event: { toolName: string; input?: ToolInput },
  context: HookContext,
) => HookResult | Promise<HookResult>

type Call = (toolName: string, input?: ToolInput) => Promise<HookResult>

function createHarness(options: {
  cwd?: string
  hasUI?: boolean
  approvalChoice?: 'Approve' | 'Deny'
} = {}) {
  let handler: Handler | undefined
  const approvalPrompts: Array<{ title: string; options: string[] }> = []

  registerPermissionGuard({
    on(event: string, callback: Handler) {
      assert.equal(event, 'tool_call')
      handler = callback
    },
  } as never)

  assert.ok(handler)

  const context: HookContext = {
    cwd: options.cwd ?? 'D:/workspace/project',
    hasUI: options.hasUI ?? false,
    ui: {
      async select(title, choices) {
        approvalPrompts.push({ title, options: choices })
        return options.approvalChoice
      },
    },
  }

  return {
    approvalPrompts,
    async call(toolName: string, input: ToolInput = {}) {
      return handler?.({ toolName, input }, context)
    },
  }
}

async function assertBlocked(call: Call, toolName: string, input: ToolInput) {
  const result = await call(toolName, input)
  assert.equal(result?.block, true)
  assert.ok(result.reason)
  return result
}

async function assertAllowed(call: Call, toolName: string, input: ToolInput) {
  assert.equal(await call(toolName, input), undefined)
}

test('.env.example exception is exact, ordered, and case-insensitive', async () => {
  const { call } = createHarness()

  for (const path of [
    '.env.example',
    '.ENV.EXAMPLE',
    '.Env.Example',
    'nested/config/.env.example',
  ]) {
    await assertAllowed(call, 'read', { path })
  }

  for (const path of [
    '.ssh/.env.example',
    '.env.example.local',
    'example.env.example.local',
  ]) {
    await assertBlocked(call, 'read', { path })
  }

  await assertBlocked(call, 'grep', {
    paths: ['.env.example', '.env'],
  })
})

test('FILE_RULES matching normalizes case and trailing separators', async () => {
  const { call } = createHarness()

  await assertAllowed(call, 'read', { path: '.ENV.EXAMPLE/' })
  for (const path of [
    '.ENV/',
    '.env.local/',
    'appsettings.json/',
    'credentials.json/',
    'client-secret.txt/',
    'token.txt/',
    'id_rsa/',
    'CERTIFICATE.PEM/',
    'private.key/',
    'certificate.crt/',
    '.SSH/CONFIG/',
  ]) {
    await assertBlocked(call, 'read', { path })
  }
})

test('read strips selectors before FILE_RULES matching', async () => {
  const { call } = createHarness()

  for (const path of [
    '.env:1-5',
    '.env.local:50-',
    'credentials.json:50+150',
    'private.key:raw',
    'certificate.pem:5-16,960-973',
    'file:///D:/workspace/%2Eenv:raw',
  ]) {
    await assertBlocked(call, 'read', { path })
  }

  for (const path of [
    '.env.example:1-5',
    '.env.example:raw',
    '.env.example:2-4:raw',
    '.env.example:raw:2-4',
    'notes:raw.txt',
    'report:123abc',
  ]) {
    await assertAllowed(call, 'read', { path })
  }
})

test('every FILE_RULES deny entry blocks its protected path', async () => {
  const { call } = createHarness()
  const paths = [
    'secrets/app.json',
    '.aws/credentials',
    '.ssh/config',
    '.env',
    '.env.local',
    'appsettings.json',
    'api-credential.json',
    'client-secret.txt',
    'token.txt',
    'id_ed25519',
    'certificate.pem',
    'private.key',
    'certificate.crt',
  ]

  for (const path of paths) {
    await assertBlocked(call, 'read', { path })
  }
})

test('protected directory rules keep conservative suffix matching', async () => {
  const { call } = createHarness()
  const paths = [
    '.aws-backup',
    '.aws.example',
    '.ssh.example',
    'directory/.ssh.example/config',
    'docs/secrets-guide.md',
  ]

  for (const path of paths) {
    await assertBlocked(call, 'read', { path })
  }
})

test('filename rules only match final segments and avoid similar names', async () => {
  const { call } = createHarness()
  const paths = [
    'token-cache/ordinary.txt',
    'credential-store/ordinary.txt',
    'secret-folder/ordinary.txt',
    '.ss',
    '/home/user/.ss',
    '.ssl',
    '.ssl-certs',
    'environment.md',
    'keyboard.ts',
    'pem-notes.txt',
  ]

  for (const path of paths) {
    await assertAllowed(call, 'read', { path })
  }
})

test('guarded tools apply FILE_RULES only to supported input', async () => {
  const { call } = createHarness()
  const blockedCases: Array<[string, ToolInput]> = [
    ['read', { path: '.env' }],
    ['write', { path: '.env' }],
    ['grep', { paths: ['src', '.env'] }],
    ['edit', '[.env#ABCD]\nDEL 1'],
    ['bash', { command: 'cat .env' }],
  ]

  for (const [toolName, input] of blockedCases) {
    await assertBlocked(call, toolName, input)
  }

  await assertAllowed(call, 'read', {
    path: 'src/app.ts',
    command: 'cat .env',
    paths: ['.env'],
  })
  await assertAllowed(call, 'write', {
    path: 'src/app.ts',
    input: '.env',
  })
  await assertAllowed(call, 'grep', {
    paths: ['src'],
    command: 'cat .env',
  })
})

test('tools outside the guarded set remain allowed', async () => {
  const { call } = createHarness()
  await assertAllowed(call, 'web_search', { query: '.env' })
})

test('paths normalize separators and resolve against ctx.cwd', async () => {
  const relative = createHarness({ cwd: 'C:/Users/john/.ssh' })
  await assertBlocked(relative.call, 'read', { path: '.' })

  const windows = createHarness()
  await assertBlocked(windows.call, 'read', {
    path: 'C:\\Users\\john\\.ssh\\config',
  })
})

test('file, ssh, and vault URIs are decoded before protected-path checks', async () => {
  const { call } = createHarness()
  const paths = [
    'file:///D:/workspace/%2Eenv',
    'ssh://prod/home/app/%2Essh/id_ed25519',
    'vault://notes/private/%2Eenv',
  ]

  for (const path of paths) {
    await assertBlocked(call, 'read', { path })
  }
})

test('web and known virtual URIs skip protected-path checks', async () => {
  const { call } = createHarness()
  const paths = [
    'http://example.com/secrets/config',
    'https://example.com/.env',
    'agent://abc/.env',
    'artifact://abc/secrets',
    'conflict://abc/.ssh/config',
    'history://abc/.env',
    'issue://123/secrets',
    'local://notes/.env',
    'mcp://server/.ssh/config',
    'memory://notes/.env',
    'omp://hooks/secrets',
    'pr://123/.env',
    'rule://security/.ssh/config',
    'skill://diagnose/.env',
    'xd://tool/secrets',
  ]

  for (const path of paths) {
    await assertAllowed(call, 'read', { path })
  }
})

test('unknown URI protocols are denied even when their paths look ordinary', async () => {
  const { call } = createHarness()
  await assertBlocked(call, 'read', { path: 'unknown://host/file.txt' })
})

test('grep parses arrays, delimiters, and quoted paths', async () => {
  const { call } = createHarness()
  const blockedInputs: ToolInput[] = [
    { path: ['src', '.env'] },
    { paths: ['src', '.ssh/config'] },
    { path: 'src,.aws,docs' },
    { paths: 'src;.ssh;docs' },
    { paths: 'src secrets docs' },
    { path: '"config/private key.pem"' },
    { paths: ["'config/private key.pem'"] },
    { paths: 'src; "config/private key.pem"; docs' },
    { paths: '"config/private;key.pem", src' },
  ]

  for (const input of blockedInputs) {
    await assertBlocked(call, 'grep', input)
  }

  await assertAllowed(call, 'grep', {
    paths: 'src; "docs/release notes.txt"; tests',
  })
})

test('edit checks only valid PATH#TAG headers and ignores patch content', async () => {
  const { call } = createHarness()

  await assertBlocked(call, 'edit', '[.env#ABCD]\nDEL 1')
  await assertAllowed(call, 'edit', '[src/app.ts#ABCD]\nINS.TAIL:\n+const token = value')
  await assertAllowed(call, 'edit', '[.env#BAD]\nINS.TAIL:\n+const secret = value')
  await assertAllowed(call, 'edit', {
    input: '[src/app.ts#ABCD]\nINS.TAIL:\n+const token = value',
    path: '.env',
    command: 'cat .env',
  })
})

test('Bash scans literal paths independently of command grammar', async () => {
  const { call } = createHarness()
  const commands = [
    'cat .env',
    'cat ".ssh/config"',
    'echo ok > .aws/credentials',
    'cat .env.example && cat private.key',
    '(cat .env)',
    '{ cat .env; }',
    'if true; then cat .env; fi',
    'Get-Content -LiteralPath .env',
    'Set-Content -Path app.key -Value redacted',
    'Copy-Item src.txt -Destination secrets\\copy.txt',
    'cat "config/private key.pem"',
    'powershell -EncodedCommand ZgBvAG8A',
  ]

  for (const command of commands) {
    await assertBlocked(call, 'bash', { command })
  }

  await assertAllowed(call, 'bash', { command: '{ echo ordinary; }' })
})

test('rm -rf denies protected directories themselves but only prompts for descendants', async () => {
  const protectedCall = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  const permittedCall = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  const rejectedCall = createHarness({ hasUI: true, approvalChoice: 'Deny' })
  const protectedDirectories = [
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/home',
    '/lib',
    '/lib64',
    '/mnt',
    '/opt',
    '/proc',
    '/root',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
    '~',
  ]

  for (const directory of protectedDirectories) {
    await assertBlocked(protectedCall.call, 'bash', { command: `rm -rf ${directory}` })
    await assertBlocked(protectedCall.call, 'bash', { command: `rm -rf "${directory}/"` })
    await assertAllowed(permittedCall.call, 'bash', { command: `rm -rf ${directory}/child` })
  }

  for (const letter of ['a', 'Z']) {
    await assertBlocked(protectedCall.call, 'bash', { command: `rm -rf /mnt/${letter}` })
    await assertBlocked(protectedCall.call, 'bash', { command: `rm -rf /${letter}/` })
    await assertAllowed(permittedCall.call, 'bash', { command: `rm -rf /mnt/${letter}/child` })
    await assertAllowed(permittedCall.call, 'bash', { command: `rm -rf /${letter}/child` })
  }

  await assertBlocked(protectedCall.call, 'bash', { command: 'rm -rf build /etc' })
  await assertBlocked(protectedCall.call, 'bash', { command: 'rm -rf -- /var' })
  assert.equal(protectedCall.approvalPrompts.length, 0)

  await assertAllowed(permittedCall.call, 'bash', { command: 'rm -rf /etcetera' })
  await assertAllowed(permittedCall.call, 'bash', { command: 'rm -rf /mnt/zz' })
  await assertAllowed(permittedCall.call, 'bash', { command: 'rm -rf /mnt/1' })
  await assertAllowed(permittedCall.call, 'bash', { command: 'rm -r /etc' })
  await assertAllowed(permittedCall.call, 'bash', { command: 'cat /etc/hosts' })

  await assertBlocked(rejectedCall.call, 'bash', { command: 'rm -rf build' })
  assert.equal(rejectedCall.approvalPrompts.length, 1)
})

test('rm recursive and force options preserve prompt behavior', async () => {
  const accepted = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  const rejected = createHarness({ hasUI: true, approvalChoice: 'Deny' })
  const commands = [
    'rm -r build',
    'rm -f report.txt',
    'rm -fr cache',
    'rm -rf output',
  ]

  for (const command of commands) {
    await assertAllowed(accepted.call, 'bash', { command })
    await assertBlocked(rejected.call, 'bash', { command })
  }

  assert.equal(accepted.approvalPrompts.length, commands.length)
  assert.equal(rejected.approvalPrompts.length, commands.length)
})

test('Bash checks explicit cwd and env path candidates', async () => {
  const { call } = createHarness({ cwd: 'D:/workspace/project' })

  await assertBlocked(call, 'bash', { command: 'echo ok', cwd: '.ssh' })
  await assertBlocked(call, 'bash', {
    command: 'echo ok',
    cwd: 'C:/Users/john/.aws',
  })
  await assertBlocked(call, 'bash', {
    command: 'echo ok',
    env: { OUTPUT: '.env' },
  })
  await assertAllowed(call, 'bash', {
    command: 'echo ok',
    env: { OUTPUT: 'output.txt' },
  })
})

test('Unix and Windows shell variables fail closed without UI', async () => {
  const { call } = createHarness()
  const commands = [
    'cat "$TARGET_PATH"',
    'cat "${TARGET_PATH}"',
    'echo "$1"',
    'echo "$?"',
    'echo "$@"',
    'echo "$*"',
    'echo "$#"',
    'echo "$-"',
    'echo "$$"',
    'echo "$!"',
    'echo %TARGET_PATH%',
    'echo !TARGET_PATH!',
  ]

  for (const command of commands) {
    await assertBlocked(call, 'bash', { command })
  }
})

test('command and process substitutions fail closed without UI', async () => {
  const { call } = createHarness()
  const commands = [
    'echo $(cat ordinary.txt)',
    'echo `cat ordinary.txt`',
    'cat <(echo ordinary)',
    'cat >(echo ordinary)',
  ]

  for (const command of commands) {
    await assertBlocked(call, 'bash', { command })
  }
})


test('wrapped command execution fails closed without UI', async () => {
  const { call } = createHarness()
  const commands = [
    'bash -c "cat ordinary.txt"',
    'cmd /c type ordinary.txt',
    'powershell -Command Get-Content ordinary.txt',
    'python -c "print(\'ok\')"',
  ]

  for (const command of commands) {
    await assertBlocked(call, 'bash', { command })
  }
})

test('decode commands fail closed without UI', async () => {
  const { call } = createHarness()
  const commands = [
    'base64 -d payload.txt',
    'certutil -decode payload.txt output.txt',
    'openssl base64 -d -in payload.txt',
  ]

  for (const command of commands) {
    await assertBlocked(call, 'bash', { command })
  }
})

test('dynamic shell syntax prompts once and respects the UI decision', async () => {
  const denied = createHarness({ hasUI: true, approvalChoice: 'Deny' })
  await assertBlocked(denied.call, 'bash', { command: 'cat "$TARGET_PATH"' })
  assert.equal(denied.approvalPrompts.length, 1)

  const allowed = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  await assertAllowed(allowed.call, 'bash', { command: 'cat "$TARGET_PATH"' })
  assert.equal(allowed.approvalPrompts.length, 1)
})

test('literal path denials take precedence over shell approval', async () => {
  const literal = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  await assertBlocked(literal.call, 'bash', {
    command: 'cat .env "$OTHER"',
  })
  assert.equal(literal.approvalPrompts.length, 0)

  const env = createHarness({ hasUI: true, approvalChoice: 'Approve' })
  await assertBlocked(env.call, 'bash', {
    command: 'sudo bash -c "cat $TARGET_PATH"',
    env: { OUTPUT_PATH: '.env' },
  })
  assert.equal(env.approvalPrompts.length, 0)
})

test('approval prompts follow OMP format without exposing dynamic input', async () => {
  for (const approvalChoice of [undefined, 'Deny', 'Approve'] as const) {
    const harness = createHarness({ hasUI: true, approvalChoice })
    const result = await harness.call('bash', { command: 'cat "$TARGET_PATH"' })

    assert.equal(result?.block, approvalChoice === 'Approve' ? undefined : true)
    assert.equal(harness.approvalPrompts.length, 1)

    const [prompt] = harness.approvalPrompts
    assert.match(prompt.title, /^Allow tool: bash\nReason: shell pattern /)
    assert.equal(prompt.title.includes('$TARGET_PATH'), false)
    assert.deepEqual(prompt.options, ['Approve', 'Deny'])
  }
})

test('denial reasons identify only the matched regex, not the raw path', async () => {
  const { call } = createHarness()
  const path = 'secrets/customer-data.json'
  const result = await assertBlocked(call, 'read', { path })

  assert.match(result.reason ?? '', /protected-path pattern/)
  assert.match(result.reason ?? '', /\(\^\|\\\/\)secrets/)
  assert.equal(result.reason?.includes(path), false)
})

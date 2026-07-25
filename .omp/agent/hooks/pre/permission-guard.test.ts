import assert from 'node:assert/strict'
import test from 'node:test'

import registerPermissionGuard, { protectedPathReason } from './permission-guard.ts'

type ToolInput = Record<string, unknown> | string

type HookContext = {
  cwd: string
  hasUI: boolean
  ui: {
    confirm: (title: string, message: string) => Promise<boolean>
  }
}

type HookResult = { block?: boolean; reason?: string } | undefined

type ToolCallHandler = (
  event: { toolName: string; input?: ToolInput },
  context: HookContext,
) => Promise<HookResult>

function createHarness(options: { cwd?: string; hasUI?: boolean; confirm?: boolean } = {}) {
  let handler: ToolCallHandler | undefined
  const confirmations: Array<{ title: string; message: string }> = []

  registerPermissionGuard({
    on(event: string, callback: ToolCallHandler) {
      assert.equal(event, 'tool_call')
      handler = callback
    },
  } as never)

  assert.ok(handler)

  const context: HookContext = {
    cwd: options.cwd ?? 'D:/workspace/project',
    hasUI: options.hasUI ?? false,
    ui: {
      async confirm(title, message) {
        confirmations.push({ title, message })
        return options.confirm ?? false
      },
    },
  }

  return {
    confirmations,
    async call(toolName: string, input: ToolInput = {}) {
      return handler?.({ toolName, input }, context)
    },
  }
}

async function assertBlocked(
  toolName: string,
  input: ToolInput,
  forbiddenReasonFragments: string[] = [],
) {
  const harness = createHarness()
  const result = await harness.call(toolName, input)
  assert.equal(result?.block, true)
  assert.ok(result?.reason)
  for (const fragment of forbiddenReasonFragments) {
    assert.equal(result.reason.includes(fragment), false)
  }
}

async function assertAllowed(toolName: string, input: ToolInput) {
  const harness = createHarness()
  assert.equal(await harness.call(toolName, input), undefined)
}

test('dedicated tools share protected-path policy across path shapes', async () => {
  await assertBlocked('read', { path: '.env' })
  await assertBlocked('write', { path: 'file:///D:/workspace/project/.env' }, [
    'file:///D:/workspace/project/.env',
  ])
  await assertBlocked('read', { path: 'ssh://prod/home/app/.ssh/id_ed25519' }, [
    'ssh://prod/home/app/.ssh/id_ed25519',
  ])
  await assertBlocked('read', { path: 'vault://notes/private/.env' }, [
    'vault://notes/private/.env',
  ])
  await assertBlocked('grep', { paths: ['src', '.aws/credentials'] }, ['.aws/credentials'])
  await assertBlocked('grep', { path: ['src', 'secrets/app.json'] }, ['secrets/app.json'])
  await assertBlocked('grep', { paths: '.env.example; .ssh/config' }, ['.ssh/config'])
  await assertBlocked('grep', { path: '.env;src' }, ['.env;src'])
  await assertBlocked('edit', {
    input: '[src/app.ts#ABCD]\nINS.TAIL:\n+ok\n[secrets/app.json#1234]\nDEL 1',
  }, ['secrets/app.json'])
})

test('the .env.example exception applies to one candidate only', async () => {
  await assertAllowed('read', { path: '.env.example' })
  await assertAllowed('read', { path: '.env.example:1-5' })
  await assertAllowed('read', { path: 'nested/config/.env.example' })
  await assertBlocked('read', { path: '.ssh/.env.example' })
  await assertBlocked('grep', { paths: ['.env.example', '.env'] })
})

test('web and confirmed virtual URIs remain allowed while unknown protocols fail closed', async () => {
  await assertAllowed('read', { path: 'https://example.com/.env' })
  await assertAllowed('read', { path: 'http://example.com/secrets/config' })
  await assertAllowed('read', { path: 'skill://diagnose' })
  await assertAllowed('grep', { paths: ['omp://hooks.md', 'agent://abc'] })
  await assertBlocked('read', { path: 'unknown://host/.env.example' }, [
    'unknown://host/.env.example',
  ])
})

test('protected directory roots and path variants fail closed', async () => {
  const blockedPaths = [
    'secrets',
    'secrets/',
    './secrets',
    'src/secrets',
    'src/secrets/file.txt',
    'my-secrets',
    'secrets.txt',
    'docs/secrets-guide.md',
    '.aws',
    '.aws/',
    '.aws/credentials',
    '.aws-backup',
    '.aws.example',
    './.aws',
    '.aws/.',
    'src/../.aws/credentials',
    '.ssh',
    '.ssh/',
    '.ssh/config',
    '.ssh-backup',
    '.ssh.example',
    'directory/.ssh.example/config',
    './.ssh',
    '.ssh/.',
    'src/../.ssh/config',
    'C:\\Users\\user\\.aws',
    'C:\\Users\\user\\.aws\\credentials',
    'C:/Users/user/.aws/credentials',
    'C:\\Users/user\\.ssh/config',
    '/home/user/.aws/credentials',
    '/home/user/.ssh',
    '/home/user/.ssh/config',
    'C:\\Users\\user\\.AWS',
    '/home/user/.SSH/config',
  ]

  for (const path of blockedPaths) await assertBlocked('read', { path })

  for (const [cwd, paths] of [
    ['D:/users/lucas/.ssh', ['.', '..', 'config']],
    ['D:/users/lucas/.aws', ['.', '..', 'credentials']],
  ] as const) {
    const harness = createHarness({ cwd })
    for (const path of paths) {
      assert.equal((await harness.call('read', { path }))?.block, true)
    }
  }

  const secrets = createHarness()
  const result = await secrets.call('read', { path: 'secrets' })
  assert.equal(result?.block, true)
  assert.equal(result?.reason?.includes('secrets/ directory'), true)
  const legacySecret = await secrets.call('read', { path: 'my-secrets' })
  assert.equal(legacySecret?.reason?.includes("filename contains 'secret'"), true)
  assert.equal(protectedPathReason('my-secrets'), "filename contains 'secret'")

})

test('protected-path helper reports the matched conservative prefix', () => {
  const cases = [
    ['secrets', 'secrets/ directory'],
    ['secrets/', 'secrets/ directory'],
    ['docs/secrets-guide.md', 'secrets/ directory'],
    ['.aws', '.aws/ directory'],
    ['C:\\Users\\user\\.AWS\\credentials', '.aws/ directory'],
    ['directory/.aws-backup/file.txt', '.aws/ directory'],
    ['.ssh.example', '.ssh/ directory'],
    ['C:\\Users/user\\.SSH/config', '.ssh/ directory'],
    ['nested/config/.env', '.env file (*.env)'],
    ['nested/config/.env.local', '.env.* file (*.env.*)'],
    ['nested/config/appsettings.json', 'appsettings.json'],
    ['home/user/id_ed25519', 'SSH private key'],
    ['nested/api-credential.json', "filename contains 'credential'"],
    ['nested/client-secret.txt', "filename contains 'secret'"],
    ['D:/workspace/token.txt', "filename contains 'token'"],
    ['certs/certificate.pem', '.pem file'],
    ['certs/private.key', '.key file'],
    ['certs/certificate.crt', '.crt file'],
  ] as const

  for (const [path, expectedReason] of cases) {
    assert.equal(protectedPathReason(path), expectedReason)
  }
})

test('filename rules only match the final path segment', async () => {
  const paths = [
    'token-cache/ordinary.txt',
    'credential-store/ordinary.txt',
    'secret-folder/ordinary.txt',
  ]

  for (const path of paths) {
    assert.equal(protectedPathReason(path), undefined)
    await assertAllowed('read', { path })
  }
})

test('protected-looking cwd denies ordinary relative paths', async () => {
  const harness = createHarness({ cwd: 'D:/workspace/token-project' })
  const result = await harness.call('read', { path: 'ordinary.txt' })

  assert.equal(result?.block, true)
  assert.equal(result?.reason?.includes("filename contains 'token'"), true)
})

test('unrelated .ss and .ssl paths remain allowed', async () => {
  const paths = ['.ss', '/home/user/.ss', '.ssl', '.ssl-certs']

  for (const path of paths) {
    assert.equal(protectedPathReason(path), undefined)
    await assertAllowed('read', { path })
  }
})

test('all guarded tools use the same protected-path helper', async () => {
  await assertBlocked('read', { path: '.aws' })
  await assertBlocked('write', { path: '.ssh/config' })
  await assertBlocked('grep', { paths: ['src', '.aws-backup'] })
  await assertBlocked('edit', '[secrets/app.json#ABCD]\nDEL 1')
  await assertBlocked('bash', { command: 'cat directory/.ssh.example/config' })
})

test('grep checks path, paths, arrays, and every delimited path', async () => {
  const inputs: ToolInput[] = [
    { path: '.ssh' },
    { paths: '.ssh' },
    { paths: ['.ssh'] },
    { paths: ['src', '.ssh'] },
    { paths: ['.aws', 'src'] },
    { path: ['src', '.aws-backup'] },
    { path: 'src,.aws,docs' },
    { paths: 'src;.ssh;docs' },
    { path: 'src .ssh.example docs' },
    { paths: 'src secrets docs' },
    { path: 'src ".aws" docs' },
    '.ssh',
  ]

  for (const input of inputs) await assertBlocked('grep', input)
})

test('sensitive extensions are case-insensitive without widening the example exception', async () => {
  const blockedPathCases = [
    ['*.env', ['.env', '.ENV', 'production.Env']],
    ['*.env.*', ['.env.local', '.ENV.LOCAL', '.Env.Local']],
    ['*.pem', ['certificate.pem', 'certificate.PEM', 'certificate.Pem']],
    ['*.key', ['private.key', 'private.KEY', 'private.Key']],
    ['*.crt', ['certificate.crt', 'certificate.CRT', 'certificate.Crt']],
    ['post-example suffix', ['.env.example.local', 'example.env.example.local']],
  ] as const

  for (const [rule, paths] of blockedPathCases) {
    for (const path of paths) {
      await assertBlocked('read', { path })
      assert.ok(protectedPathReason(path), `${rule} should block ${path}`)
    }
  }

  const allowedPaths = [
    '.env.example',
    '.ENV.EXAMPLE',
    '.Env.Example',
    'example.env.example',
    'environment.md',
    'keyboard.ts',
    'pem-notes.txt',
  ]

  for (const path of allowedPaths) {
    await assertAllowed('read', { path })
    assert.equal(protectedPathReason(path), undefined)
  }
})

test('shell direct syntax checks arguments, redirects, cwd, and explicit env', async () => {
  const blockedCalls: Array<Record<string, unknown>> = [
    { command: 'cat .env' },
    { command: 'cat "config/private key.pem" | sed -n "1p"' },
    { command: 'printf ok | tee secrets/output.txt' },
    { command: 'echo ok > .aws/credentials' },
    { command: 'echo ok; type .ssh\\config' },
    { command: 'Get-Content -LiteralPath .env' },
    { command: 'Set-Content -Path app.key -Value redacted' },
    { command: 'Copy-Item src.txt -Destination secrets\\copy.txt' },
    { command: 'Remove-Item credentials.json' },
    { command: 'copy src.txt token.txt' },
    { command: 'move src.txt certificate.crt' },
    { command: 'del app.pem' },
    { command: 'pwd', cwd: 'D:/users/lucas/.ssh/configs' },
    {
      command: 'echo ok',
      env: { OUTPUT_PATH: 'D:/users/lucas/.aws/credentials' },
    },
  ]

  for (const input of blockedCalls) {
    await assertBlocked('bash', input, [
      String(input.command),
      String(input.cwd ?? ''),
      String((input.env as Record<string, string> | undefined)?.OUTPUT_PATH ?? ''),
    ].filter(Boolean))
  }

  await assertAllowed('bash', { command: 'cat .env.example' })
  await assertBlocked('bash', { command: 'grep password .env' }, ['grep password .env'])
  await assertAllowed('bash', { command: 'grep warning src/app.ts' })
  await assertAllowed('bash', { command: 'npm test', cwd: 'D:/workspace/project' })
  await assertAllowed('bash', {
    command: 'printf done',
    env: { OUTPUT_PATH: 'D:/workspace/project/output.txt' },
  })
})

test('shell literal scanning is independent of command grammar', async () => {
  const blockedCommands = [
    '(cat .env)',
    '{ cat .env; }',
    'if true; then cat .env; fi',
    'Write-Output .ssh/config',
    'grep secret src/app.ts',
    'cat .env.example && cat private.key',
  ]

  for (const command of blockedCommands) await assertBlocked('bash', { command }, [command])

  await assertAllowed('bash', { command: '{ echo ordinary; }' })
  await assertAllowed('bash', { command: 'cat .env.example' })
})

test('dynamic shell syntax confirms with UI and fails closed headlessly', async () => {
  await assertBlocked('bash', { command: 'cat "$TARGET_PATH"' }, ['$TARGET_PATH'])
  await assertBlocked('bash', { command: 'echo $(Get-Content config.txt)' }, [
    'echo $(Get-Content config.txt)',
  ])
  await assertBlocked('bash', { command: 'cat \"unterminated' }, ['cat \"unterminated'])
  await assertBlocked('bash', { command: 'bash -c \"cat ordinary.txt\"' }, [
    'bash -c \"cat ordinary.txt\"',
  ])
  await assertBlocked('bash', { command: 'powershell -EncodedCommand ZgBvAG8A' }, [
    'powershell -EncodedCommand ZgBvAG8A',
  ])
  await assertAllowed('bash', { command: "cat '$TARGET_PATH'" })

  const denied = createHarness({ hasUI: true, confirm: false })
  const deniedResult = await denied.call('bash', { command: 'cat "$TARGET_PATH"' })
  assert.equal(deniedResult?.block, true)
  assert.equal(denied.confirmations.length, 1)
  assert.equal(denied.confirmations[0].message.includes('$TARGET_PATH'), false)

  const approved = createHarness({ hasUI: true, confirm: true })
  assert.equal(await approved.call('bash', { command: 'cat "$TARGET_PATH"' }), undefined)
  assert.equal(approved.confirmations.length, 1)
  assert.equal(approved.confirmations[0].message.includes('$TARGET_PATH'), false)
})

test('wrapped dynamic execution uses one prompt and fails closed headlessly', async () => {
  const wrappedCommands = [
    'sudo bash -c "cat ordinary.txt"',
    'command sh -c "cat ordinary.txt"',
    'sudo -u root bash -c "cat ordinary.txt"',
    'sudo -H bash -c "cat ordinary.txt"',
    'command -p sh -c "cat ordinary.txt"',
    'OUTPUT_PATH=ordinary.txt sudo bash -c "cat ordinary.txt"',
    'sudo powershell -Command Get-Content ordinary.txt',
  ]

  for (const command of wrappedCommands) {
    await assertBlocked('bash', { command }, [command])
  }

  const approved = createHarness({ hasUI: true, confirm: true })
  assert.equal(await approved.call('bash', {
    command: 'sudo bash -c "cat $TARGET_PATH"',
  }), undefined)
  assert.equal(approved.confirmations.length, 1)

  const deniedBeforePrompt = createHarness({ hasUI: true, confirm: true })
  const denied = await deniedBeforePrompt.call('bash', {
    command: 'sudo bash -c "cat $TARGET_PATH"',
    env: { OUTPUT_PATH: '.env' },
  })
  assert.equal(denied?.block, true)
  assert.equal(deniedBeforePrompt.confirmations.length, 0)
})

test('literal protected paths win over dynamic-shell confirmation', async () => {
  const harness = createHarness({ hasUI: true, confirm: true })
  const result = await harness.call('bash', { command: 'cat .env "$OTHER"' })
  assert.equal(result?.block, true)
  assert.equal(harness.confirmations.length, 0)
})

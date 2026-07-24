import assert from 'node:assert/strict'
import test from 'node:test'

import registerPermissionGuard from './permission-guard.ts'

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
    '.aws',
    '.aws-backup',
    '.ssh',
    '.ssh.example',
    '.ss',
    'C:\\Users\\user\\.AWS',
    '/home/user/.SSH/config',
    'src/../.ssh/config',
  ]

  for (const path of blockedPaths) await assertBlocked('read', { path })

  await assertBlocked('grep', { paths: ['src', '.ssh'] })
  await assertBlocked('edit', {
    input: '[.aws#ABCD]\nINS.TAIL:\n+blocked',
  })

  const protectedCwd = createHarness({ cwd: 'D:/users/lucas/.ssh' })
  assert.equal((await protectedCwd.call('read', { path: '..' }))?.block, true)

  const secrets = createHarness()
  const result = await secrets.call('read', { path: 'secrets' })
  assert.equal(result?.block, true)
  assert.equal(result?.reason?.includes('secrets/ directory'), true)
})

test('sensitive extensions are case-insensitive without widening the example exception', async () => {
  const blockedPaths = [
    '.ENV',
    'production.Env',
    '.ENV.LOCAL',
    'certificate.PEM',
    'private.Key',
    'certificate.CRT',
    '.env.example.local',
  ]

  for (const path of blockedPaths) await assertBlocked('read', { path })

  await assertAllowed('read', { path: '.ENV.EXAMPLE' })
  await assertAllowed('read', { path: '.Env.Example' })
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

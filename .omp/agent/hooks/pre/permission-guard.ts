/**
 * Permission Guard Hook (PreToolUse)
 *
 * Intercepts read/edit/write/grep and blocks access to sensitive files
 * and directories. Fills the gap where OMP's tools.approval cannot do
 * path-based matching.
 */

import { basename } from 'node:path'
import type { HookAPI } from '@oh-my-pi/pi-coding-agent/extensibility/hooks'

// Deny rules

const SECRET_DENY_RULES: Array<{
  name: string
  test: (fullPath: string, base: string) => boolean
}> = [
  // *.env (.env.example ends with .example, not .env)
  {
    name: '.env file (*.env)',
    test: (_full, base) => base.endsWith('.env'),
  },
  // *.env.* (explicitly excludes .env.example)
  {
    name: '.env.* file (*.env.*)',
    test: (_full, base) =>
      /\.env\./i.test(base) && !/\.env\.example$/i.test(base),
  },
  // secrets/ directory
  {
    name: 'secrets/ directory',
    test: (full) => /(^|[/\\])secrets[/\\]/i.test(full),
  },
  // appsettings.json
  {
    name: 'appsettings.json',
    test: (_full, base) => base.toLowerCase() === 'appsettings.json',
  },
  // filename contains "credential"
  {
    name: "filename contains 'credential'",
    test: (_full, base) => /credential/i.test(base),
  },
  // filename contains "secret"
  {
    name: "filename contains 'secret'",
    test: (_full, base) => /secret/i.test(base),
  },
  // filename contains "token"
  {
    name: "filename contains 'token'",
    test: (_full, base) => /token/i.test(base),
  },
  // .aws/ directory
  {
    name: '.aws/ directory',
    test: (full) => /(^|[/\\])\.aws[/\\]/i.test(full),
  },
  // .ssh/ directory
  {
    name: '.ssh/ directory',
    test: (full) => /(^|[/\\])\.ssh[/\\]/i.test(full),
  },
  // certificate and key files
  { name: '.pem file', test: (_full, base) => base.endsWith('.pem') },
  { name: '.key file', test: (_full, base) => base.endsWith('.key') },
  { name: '.crt file', test: (_full, base) => base.endsWith('.crt') },
]

// Path checking

/** Checks a path against all deny rules; returns the matched rule name or null. */
function checkPath(rawPath: string): string | null {
  if (!rawPath) return null

  // Skip URLs and internal URIs (skill://, omp://, agent://, local://, etc.)
  if (/^[a-z]+:\/\//i.test(rawPath)) return null

  const normalized = rawPath.replace(/\\/g, '/')
  const base = basename(normalized)

  for (const rule of SECRET_DENY_RULES) {
    if (rule.test(normalized, base)) {
      return rule.name
    }
  }
  return null
}

/** Extracts file paths from edit tool input by parsing [PATH#TAG] headers. */
function extractEditPaths(input: string): string[] {
  const paths: string[] = []
  const re = /^\[([^\]#]+)#[0-9A-F]{4}\]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    paths.push(m[1].trim())
  }
  return paths
}

// Hook registration

export default function (pi: HookAPI): void {
  pi.on('tool_call', async (event) => {
    const tool = event.toolName
    const input = event.input ?? {}

    // read / write / grep: check the path field directly
    if (tool === 'read' || tool === 'write' || tool === 'grep') {
      const path = String(input.path ?? '')
      const blocked = checkPath(path)
      if (blocked) {
        return {
          block: true,
          reason: `Permission denied: ${blocked} (path: ${path})`,
        }
      }
    }

    // edit: parse [PATH#TAG] headers from the input text
    if (tool === 'edit') {
      const text = String(input.input ?? '')
      const paths = extractEditPaths(text)
      for (const p of paths) {
        const blocked = checkPath(p)
        if (blocked) {
          return {
            block: true,
            reason: `Permission denied: ${blocked} (path: ${p})`,
          }
        }
      }
    }
  })
}

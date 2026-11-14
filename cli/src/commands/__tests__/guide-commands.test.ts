import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { onboardingGuides, skillMarkdown } from '../skill-content.js'
import { jobCommand } from '../jobs.js'
import { runCommand } from '../runs.js'
import { agentCommand } from '../agent.js'
import { skillsCommand } from '../skills.js'
import { ciCommand } from '../ci.js'

// The real command tree for every top-level command the ship recipe uses; a new one must be added here.
const roots = new Map<string, Command>([jobCommand, runCommand, agentCommand, skillsCommand, ciCommand].map((c) => [c.name(), c]))

/** Every `supercheck ...` command in a text: inline code, code-block lines, and `npx @supercheck/cli ...`. */
export function extractCommands(text: string): string[] {
  const found = new Set<string>()
  for (const raw of text.split(/`|\n/)) {
    const m = raw.match(/(?:^|\s)(?:npx @supercheck\/cli|supercheck)\s+([a-z].*)$/)
    if (m) found.add(m[1].replace(/\s+#.*$/, '').replace(/,\s.*$/, '').trim()) // drop trailing comments and prose
  }
  return [...found]
}

/** Resolve subcommands by name and check every --flag exists on the resolved command. */
export function checkCommand(line: string): string | null {
  const tokens = line.split(/\s+/)
  let cmd = roots.get(tokens[0])
  if (!cmd) return `unknown command "${tokens[0]}"`
  let i = 1
  for (; i < tokens.length; i++) {
    const sub: Command | undefined = cmd.commands.find((c) => c.name() === tokens[i])
    if (!sub) break
    cmd = sub
  }
  if (cmd.commands.length > 0 && !cmd.registeredArguments.length && i < tokens.length && !tokens[i].startsWith('-')) {
    return `unknown subcommand "${tokens[i]}" of "${cmd.name()}"`
  }
  for (const token of tokens.slice(i)) {
    if (!token.startsWith('--')) continue
    if (token === '--json') continue // global flag on the root program
    if (!cmd.options.some((o) => o.long === token)) return `unknown flag ${token} on "${cmd.name()}"`
  }
  return null
}

const docsPage = readFileSync(join(process.cwd(), '..', 'docs', 'content', 'docs', 'cli', 'after-ship-check.mdx'), 'utf8')

describe('commands in the ship guide and the after-ship docs page', () => {
  const sources = {
    'skills ship': onboardingGuides.ship,
    'skill index': skillMarkdown('test').split('## Core loop')[1].split('## Guides')[0].split('\n').filter((l) => l.includes('After every ship')).join('\n'),
    'after-ship-check.mdx': docsPage,
  }

  for (const [name, text] of Object.entries(sources)) {
    it(`${name}: every command parses against the real CLI`, () => {
      const commands = extractCommands(text)
      expect(commands.length).toBeGreaterThan(0)
      expect(commands.map((c) => [c, checkCommand(c)]).filter(([, err]) => err)).toEqual([])
    })
  }

  it('the checker catches unknown commands and flags', () => {
    expect(checkCommand('jobs run --id x')).toMatch(/unknown command/)
    expect(checkCommand('job run --id x --bogus')).toMatch(/unknown flag/)
    expect(checkCommand('job launch --id x')).toMatch(/unknown subcommand/)
    expect(checkCommand('job run --id <job-id> --wait --timeout 600 --json')).toBeNull()
  })

  it('the docs page covers every agent target named in the guide table', () => {
    for (const target of ['claude', 'cursor', 'codex', 'generic']) expect(docsPage).toContain(`--target ${target}`)
  })
})

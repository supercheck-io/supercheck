import { Command } from 'commander'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { outputDetail } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { CLI_VERSION } from '../version.js'
import { skillMarkdown } from './skill-content.js'

export const AGENT_TARGETS = ['claude', 'cursor', 'codex', 'opencode', 'generic'] as const
export type AgentTarget = (typeof AGENT_TARGETS)[number]

const BEGIN = '<!-- supercheck:begin -->'
const END = '<!-- supercheck:end -->'
const POINTER = `${BEGIN}\n## Supercheck\nThis repo uses the Supercheck CLI for tests and monitoring. Run \`supercheck onboard --json\` for the next step and \`supercheck skills\` for versioned guides. Never commit credentials.\n${END}`

function targetPath(target: AgentTarget): string {
  switch (target) {
    case 'claude': return '.claude/skills/supercheck/SKILL.md'
    case 'cursor': return '.cursor/rules/supercheck.mdc'
    default: return '.agents/skills/supercheck/SKILL.md'
  }
}

function render(target: AgentTarget): string {
  const body = skillMarkdown(CLI_VERSION)
  if (target !== 'cursor') return body
  // Cursor rule files use their own frontmatter.
  return body.replace(/^---[\s\S]*?---\n/, '---\ndescription: Use the Supercheck CLI to author, run and deploy Playwright and k6 tests\nalwaysApply: false\n---\n')
}

/** Refuse destinations that escape the working directory or pass through symlinks. */
function assertInside(cwd: string, path: string): void {
  const rel = relative(cwd, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new CLIError(`Refusing to write outside the project: ${path}`, ExitCode.ConfigError)
  let current = path
  while (current.length > cwd.length) {
    try { if (lstatSync(current).isSymbolicLink()) throw new CLIError(`Refusing to write through a symlink: ${current}`, ExitCode.ConfigError) } catch (error) { if (error instanceof CLIError) throw error }
    current = dirname(current)
  }
}

export function installAgentSkill(options: { target: AgentTarget; path?: string; force?: boolean; pointer?: string; cwd?: string }): Record<string, unknown> {
  const cwd = options.cwd ?? process.cwd()
  const file = options.path ? resolve(cwd, options.path, 'SKILL.md') : resolve(cwd, targetPath(options.target))
  if (options.path !== undefined && options.path.startsWith('/')) { /* explicit absolute --path is the user's choice */ } else assertInside(cwd, file)
  const pointerFile = options.pointer ? resolve(cwd, options.pointer) : undefined
  if (pointerFile) assertInside(cwd, pointerFile) // validate every destination before writing anything
  if (existsSync(file) && !options.force) throw new CLIError(`Skill already exists: ${file}. Use --force to replace it.`, ExitCode.ConfigError)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, render(options.target), { flag: options.force ? 'w' : 'wx' })

  let pointer: string | undefined
  if (pointerFile) {
    const current = existsSync(pointerFile) ? readFileSync(pointerFile, 'utf8') : ''
    // Only a single, well-formed owned block is ever rewritten. Anything ambiguous (stray, duplicated or
    // reversed markers, or markers quoted inside user text) is refused rather than guessed at.
    const lines = current.split('\n')
    const begins = lines.flatMap((l, i) => (l.trim() === BEGIN ? [i] : []))
    const ends = lines.flatMap((l, i) => (l.trim() === END ? [i] : []))
    const mentions = (current.match(/supercheck:(begin|end)/g) ?? []).length
    let next: string
    if (begins.length === 0 && ends.length === 0 && mentions === 0) {
      next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${POINTER}\n`
    } else if (begins.length === 1 && ends.length === 1 && begins[0] < ends[0] && mentions === 2) {
      next = [...lines.slice(0, begins[0]), POINTER, ...lines.slice(ends[0] + 1)].join('\n')
    } else {
      throw new CLIError(`${pointerFile} contains unexpected supercheck markers. Fix or remove them by hand, then run again.`, ExitCode.ConfigError)
    }
    writeFileSync(pointerFile, next)
    pointer = pointerFile
  }
  return { installed: true, target: options.target, path: file, ...(pointer ? { pointer } : {}), version: CLI_VERSION }
}

export const agentCommand = new Command('agent').description('Set up coding-agent integration')
agentCommand.command('install')
  .description('Install the Supercheck skill for a coding agent (never overwrites existing files without --force)')
  .option('--target <agent>', `One of: ${AGENT_TARGETS.join(', ')}`, 'generic')
  .option('--path <directory>', 'Install SKILL.md into this directory instead of the target default')
  .option('--pointer <file>', 'Also add a short owned block to this instructions file (for example AGENTS.md or CLAUDE.md)')
  .option('--force', 'Replace an existing skill file')
  .action((options: { target: string; path?: string; pointer?: string; force?: boolean }) => {
    if (!(AGENT_TARGETS as readonly string[]).includes(options.target)) {
      throw new CLIError(`Unknown target: ${options.target}. Use one of: ${AGENT_TARGETS.join(', ')}.`, ExitCode.ConfigError)
    }
    outputDetail(installAgentSkill({ ...options, target: options.target as AgentTarget }))
  })

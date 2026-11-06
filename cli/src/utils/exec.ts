import { getOutputFormat } from '../output/formatter.js'
import { CLIError, ExitCode } from './errors.js'
import { logger } from './logger.js'
import { redactText } from './redact.js'
import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const TEXT_LIMIT = 65536
const REPORT_LIMIT = 8 * 1024 * 1024

function exitCodeForSignal(signal: NodeJS.Signals | null): number {
  if (!signal) return 1

  const signalNumber = osConstants.signals[signal]
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1
}

/**
 * Windows cannot spawn the npx.cmd shim without a shell (EINVAL since the
 * CVE-2024-27980 fix), and a shell would expose user paths to injection. Run npm's
 * own npx-cli.js with the current node instead.
 */
export function resolveSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  exists: (path: string) => boolean = existsSync,
): { executable: string; args: string[] } {
  if (platform !== 'win32' || command !== 'npx') return { executable: command, args }
  const npxCli = join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
  if (!exists(npxCli)) {
    throw new CLIError(`Could not find npx next to node (looked for ${npxCli}). Reinstall Node.js with npm, or run Playwright directly.`, ExitCode.ConfigError)
  }
  return { executable: execPath, args: [npxCli, ...args] }
}

/**
 * Run a command with arguments in a child process.
 *
 * SECURITY: This function does NOT use shell=true to prevent command injection.
 * Pass command and args as separate parameters.
 */
export function runCommand(command: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let target: { executable: string; args: string[] }
    try { target = resolveSpawn(command, args) } catch (err) { reject(err); return }
    const executable = target.executable

    // SECURITY FIX: Remove shell: true to prevent command injection
    // spawn() with shell: false treats args as literal arguments, not shell commands
    const json = getOutputFormat() === 'json'
    let stdout = '', stderr = ''
    let stdoutTruncated = false, stderrTruncated = false
    const child = spawn(executable, target.args, {
      stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,  // ✓ SECURE: Prevents command injection
      cwd,
    })

    // Text output keeps its tail (failure details and run summaries come last); a structured report must stay whole to parse.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    // Slicing mid-line can strip a URL's scheme and defeat credential masking, so a cut drops the partial first line.
    const cut = (full: string): { text: string; truncated: boolean } => {
      if (full.length <= TEXT_LIMIT) return { text: full, truncated: false }
      const sliced = full.slice(-TEXT_LIMIT)
      const newline = sliced.indexOf('\n')
      return { text: newline === -1 ? sliced : sliced.slice(newline + 1), truncated: true }
    }
    const tail = (text: string, chunk: string): { text: string; truncated: boolean } =>
      cut(text + chunk)
    let report = '', reportOverflow = false
    child.stdout?.on('data', (chunk: string) => {
      const next = tail(stdout, chunk)
      stdout = next.text
      stdoutTruncated ||= next.truncated
      if (!reportOverflow) {
        report += chunk
        if (report.length > REPORT_LIMIT) { reportOverflow = true; report = '' }
      }
    })
    child.stderr?.on('data', (chunk: string) => {
      const next = tail(stderr, chunk)
      stderr = next.text
      stderrTruncated ||= next.truncated
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code, signal) => {
      const exitCode = code ?? exitCodeForSignal(signal)
      if (json) {
        let result: unknown = undefined
        try { result = reportOverflow ? undefined : JSON.parse(report) } catch { /* Native runners may use text output. */ }
        logger.output(JSON.stringify({ event: 'local.result', command, exitCode, result, stdout: result === undefined ? redactText(stdout) : undefined, stderr: redactText(stderr), truncated: (result === undefined && stdoutTruncated) || stderrTruncated }))
      }
      resolve(exitCode)
    })
  })
}

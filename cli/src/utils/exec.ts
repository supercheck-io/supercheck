import { getOutputFormat } from '../output/formatter.js'
import { logger } from './logger.js'
import { redactText } from './redact.js'
import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'

function exitCodeForSignal(signal: NodeJS.Signals | null): number {
  if (!signal) return 1

  const signalNumber = osConstants.signals[signal]
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1
}

/**
 * Run a command with arguments in a child process.
 *
 * SECURITY: This function does NOT use shell=true to prevent command injection.
 * Pass command and args as separate parameters.
 */
export function runCommand(command: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Windows requires the .cmd shim for npm binaries like `npx` when shell is disabled.
    const executable = process.platform === 'win32' && command === 'npx'
      ? 'npx.cmd'
      : command

    // SECURITY FIX: Remove shell: true to prevent command injection
    // spawn() with shell: false treats args as literal arguments, not shell commands
    const json = getOutputFormat() === 'json'
    let stdout = '', stderr = ''
    let truncated = false
    const child = spawn(executable, args, {
      stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,  // ✓ SECURE: Prevents command injection
      cwd,
    })

    const collect = (text: string, chunk: Buffer): string => {
      if (text.length + chunk.length > 65536) truncated = true
      return (text + chunk.toString()).slice(0, 65536)
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout = collect(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = collect(stderr, chunk) })
    child.on('error', (err) => reject(err))
    child.on('close', (code, signal) => {
      const exitCode = code ?? exitCodeForSignal(signal)
      if (json) {
        let result: unknown = undefined
        try { result = JSON.parse(stdout) } catch { /* Native runners may use text output. */ }
        logger.output(JSON.stringify({ event: 'local.result', command, exitCode, result, stdout: result === undefined ? redactText(stdout) : undefined, stderr: redactText(stderr), truncated }))
      }
      resolve(exitCode)
    })
  })
}

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
    const child = spawn(executable, args, {
      stdio: 'inherit',
      shell: false,  // ✓ SECURE: Prevents command injection
      cwd,
    })

    child.on('error', (err) => reject(err))
    child.on('close', (code, signal) => resolve(code ?? exitCodeForSignal(signal)))
  })
}

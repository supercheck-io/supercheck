import { Buffer } from 'node:buffer'
import { CLIError, ExitCode } from './errors.js'

export async function readValueFromStdin(): Promise<string> {
  const MAX_STDIN_BYTES = 1024 * 1024 // 1 MB
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of process.stdin) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    totalBytes += buf.length
    if (totalBytes > MAX_STDIN_BYTES) {
      throw new CLIError('Stdin input exceeds 1 MB limit.', ExitCode.GeneralError)
    }
    chunks.push(buf)
  }

  return Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '')
}

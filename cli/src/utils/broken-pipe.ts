/**
 * A reader that closes the pipe early (`supercheck ... | head`) is not a failure of the command: drop the
 * remaining output and let the command finish with its own exit code, so a half-finished write is not reported as success.
 */
export function ignoreBrokenPipe(stream: Pick<NodeJS.WriteStream, 'on' | 'write'>): void {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error
    stream.write = (() => true) as typeof stream.write
  })
}

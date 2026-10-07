import { createColors } from 'picocolors'

export function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY) &&
    process.env.NO_COLOR === undefined && !process.argv.includes('--no-color')
}

export default createColors(colorEnabled())

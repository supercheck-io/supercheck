/**
 * Decode, sanitize, and encode test scripts for deploy/pull/diff.
 *
 * Deploy must store UTF-8 source (Base64-encoded for the API), never compiled
 * JavaScript or appended sourcemap bytes.
 */

export function sanitizeTestScript(script: string): string {
  let text = script

  text = text.replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
  text = text.replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '')

  let binaryIndex = -1
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const isUnexpectedControlCharacter =
      code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d
    if (code === 0xfffd || isUnexpectedControlCharacter) {
      binaryIndex = index
      break
    }
  }
  if (binaryIndex >= 0) {
    text = text.slice(0, binaryIndex)
  }

  const sanitized = text.replace(/[ \t]+$/gm, '').replace(/\s+$/g, '')
  return sanitized.length > 0 ? `${sanitized}\n` : ''
}

export function decodeStoredTestScript(script: string | undefined | null): string | null {
  if (!script) return null

  try {
    const trimmed = script.trim()
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8')
    const reEncoded = Buffer.from(decoded, 'utf-8').toString('base64')
    if (reEncoded !== trimmed) {
      return sanitizeTestScript(script)
    }

    const isTextLike =
      decoded.length > 0 &&
      Array.from(decoded).every((char) => {
        const code = char.codePointAt(0) ?? 0
        return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20
      })

    if (isTextLike) {
      return sanitizeTestScript(decoded)
    }
  } catch {
    // Not valid base64 — treat as raw
  }

  return sanitizeTestScript(script)
}

export function encodeStoredTestScript(script: string): string {
  const decoded = decodeStoredTestScript(script) ?? ''
  return Buffer.from(sanitizeTestScript(decoded), 'utf8').toString('base64')
}

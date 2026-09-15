import { randomBytes } from 'node:crypto'

/**
 * Generate a UUID v7 (RFC 9562) — time-ordered, globally unique identifier.
 *
 * UUID v7 layout (128 bits):
 *   - 48 bits: Unix timestamp in milliseconds
 *   -  4 bits: version (0111 = 7)
 *   - 12 bits: random (rand_a)
 *   -  2 bits: variant (10)
 *   - 62 bits: random (rand_b)
 *
 * This matches the UUID v7 format used by the Supercheck app (Drizzle ORM),
 * ensuring consistent ID formats between CLI-created and server-created resources.
 */
export function uuidv7(): string {
  const now = Date.now()

  // 6 bytes for 48-bit timestamp
  const timestampBytes = new Uint8Array(6)
  let ts = now
  for (let i = 5; i >= 0; i--) {
    timestampBytes[i] = ts & 0xff
    ts = Math.floor(ts / 256)
  }

  // 10 bytes of random data for rand_a (12 bits) + variant (2 bits) + rand_b (62 bits)
  const randBytes = randomBytes(10)

  // Build 16-byte UUID
  const bytes = new Uint8Array(16)

  // Bytes 0-5: timestamp
  bytes.set(timestampBytes, 0)

  // Byte 6: version (0111) + rand_a high 4 bits
  bytes[6] = (0x70) | (randBytes[0] & 0x0f)

  // Byte 7: rand_a low 8 bits
  bytes[7] = randBytes[1]

  // Byte 8: variant (10) + rand_b high 6 bits
  bytes[8] = (0x80) | (randBytes[2] & 0x3f)

  // Bytes 9-15: rand_b remaining 56 bits
  bytes[9] = randBytes[3]
  bytes[10] = randBytes[4]
  bytes[11] = randBytes[5]
  bytes[12] = randBytes[6]
  bytes[13] = randBytes[7]
  bytes[14] = randBytes[8]
  bytes[15] = randBytes[9]

  // Format as hex string: 8-4-4-4-12
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

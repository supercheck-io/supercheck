import { ApiRequestError, CLIError, ExitCode } from './errors.js'
import type { ApiClient } from '../api/client.js'

export type ApiTestType = 'browser' | 'performance' | 'api' | 'database' | 'custom'

const K6_IMPORT_PATTERN = /import\s+.*\s+from\s+['"]k6(?:\/[^'"]*)?['"]/

/**
 * Detects whether a script imports any k6 modules.
 * Mirrors the server-side `isK6Script` logic from `k6-validator.ts`.
 */
export function isK6Script(script: string): boolean {
  return K6_IMPORT_PATTERN.test(script)
}

/**
 * Client-side validation that a script's content matches its declared type.
 * Returns an error message if there's a mismatch, or undefined if valid.
 *
 * Rules:
 * - k6 scripts (importing from 'k6/*') MUST have type "performance"
 * - Non-k6 scripts MUST NOT have type "performance"
 */
export function validateScriptTypeMatch(
  script: string,
  declaredType: ApiTestType | undefined,
): string | undefined {
  if (!script || !declaredType) return undefined

  const scriptIsK6 = isK6Script(script)

  if (scriptIsK6 && declaredType !== 'performance') {
    return `Script contains k6 imports but test type is "${declaredType}". k6 scripts must use type "performance".`
  }

  if (!scriptIsK6 && declaredType === 'performance') {
    return 'Test type is "performance" but script does not contain k6 imports. Performance tests require k6 scripts.'
  }

  return undefined
}

export interface TestValidationInput {
  name: string
  script: string
  testType?: ApiTestType
}

export interface TestValidationResult {
  name: string
  valid: boolean
  error?: string
  warnings?: string[]
}

export function normalizeTestTypeForApi(localType: unknown): ApiTestType | undefined {
  if (typeof localType !== 'string') return undefined

  const normalized = localType.trim().toLowerCase()

  if (normalized === 'playwright') return 'browser'
  if (normalized === 'k6') return 'performance'
  if (normalized === 'load') return 'performance'

  if (
    normalized === 'browser' ||
    normalized === 'performance' ||
    normalized === 'api' ||
    normalized === 'database' ||
    normalized === 'custom'
  ) {
    return normalized
  }

  return undefined
}

function formatValidationError(responseBody: unknown): string {
  if (responseBody && typeof responseBody === 'object') {
    const body = responseBody as Record<string, unknown>
    if (typeof body.error === 'string') {
      const line = typeof body.line === 'number' ? body.line : undefined
      const column = typeof body.column === 'number' ? body.column : undefined
      if (line !== undefined && column !== undefined) {
        return `${body.error} (line ${line}, column ${column})`
      }
      return body.error
    }
  }

  return 'Validation failed'
}

export async function validateScripts(
  client: ApiClient,
  inputs: TestValidationInput[],
): Promise<TestValidationResult[]> {
  const results: TestValidationResult[] = []

  for (const input of inputs) {
    if (!input.script || input.script.trim().length === 0) {
      throw new CLIError(`Test "${input.name}" has no script content`, ExitCode.ConfigError)
    }

    try {
      const { data } = await client.post<{ valid: boolean; warnings?: string[] }>(
        '/api/validate-script',
        {
          script: input.script,
          testType: input.testType,
        },
      )

      results.push({
        name: input.name,
        valid: data?.valid ?? true,
        warnings: data?.warnings,
      })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        results.push({
          name: input.name,
          valid: false,
          error: formatValidationError(err.responseBody),
        })
        continue
      }

      throw err
    }
  }

  return results
}

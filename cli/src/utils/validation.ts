import { ApiRequestError, CLIError, ExitCode } from './errors.js'
import { createJiti } from 'jiti'
import type { ApiClient } from '../api/client.js'

export type ApiTestType =
  | 'browser'
  | 'performance'
  | 'api'
  | 'database'
  | 'custom'

const scriptParser = createJiti(import.meta.url)

type ImportNode = {
  type: string
  importKind?: string
  exportKind?: string
  source?: { value: string }
}

/** Parse imports without executing code; jiti is already used for CLI TypeScript. */
export function isK6Script(script: string): boolean {
  let found = false
  const inspect = (value: string) => {
    if (value === 'k6' || value.startsWith('k6/')) found = true
  }
  try {
    scriptParser.transform({
      source: script,
      filename: 'script.ts',
      ts: true,
      babel: {
        plugins: [
          () => ({
            // Inspect the parsed source before TypeScript removes unused value imports.
            pre(file: { ast: { program: { body: ImportNode[] } } }) {
              for (const node of file.ast.program.body) {
                if (
                  node.source &&
                  node.importKind !== 'type' &&
                  node.exportKind !== 'type'
                )
                  inspect(node.source.value)
              }
            },
            visitor: {
              CallExpression({
                node,
              }: {
                node: {
                  callee: { type: string; name?: string }
                  arguments: { type: string; value?: string }[]
                }
              }) {
                const first = node.arguments[0]
                if (
                  node.callee.type === 'Identifier' &&
                  node.callee.name === 'require' &&
                  first?.type === 'StringLiteral' &&
                  typeof first.value === 'string'
                )
                  inspect(first.value)
              },
            },
          }),
        ],
      },
    })
  } catch {
    return false
  }
  return found
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

export function normalizeTestTypeForApi(
  localType: unknown,
): ApiTestType | undefined {
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
      throw new CLIError(
        `Test "${input.name}" has no script content`,
        ExitCode.ConfigError,
      )
    }

    try {
      const { data } = await client.post<{
        valid: boolean
        warnings?: string[]
      }>('/api/validate-script', {
        script: input.script,
        testType: input.testType,
      })

      results.push({
        name: input.name,
        valid: data?.valid === true,
        ...(!data?.valid
          ? { error: `Unexpected validation response: ${JSON.stringify(data)}` }
          : {}),
        warnings: data?.warnings,
      })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        results.push({
          name: input.name,
          valid: false,
          error: `${err.message}: ${formatValidationError(err.responseBody)}${err.responseBody === undefined ? '' : ` — ${typeof err.responseBody === 'string' ? err.responseBody : JSON.stringify(err.responseBody)}`}`,
        })
        continue
      }

      throw err
    }
  }

  return results
}

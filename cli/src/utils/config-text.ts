import { maskComments } from './link-config.js'

export interface ConfigRequirements {
  playwright: boolean
  k6: boolean
  browser: 'chromium' | 'firefox' | 'webkit'
  /** True when a runner key is present but its value is not a plain object literal (a variable, spread, or call). */
  dynamic: boolean
}

/**
 * Which runners a supercheck.config.ts configures, found by reading it as TEXT (the file is code and is never
 * executed here). Comments are ignored. A runner key counts as configured however its value is written
 * (`playwright: {...}`, `playwright: pw`, shorthand `playwright,`), so "required" is never under-reported;
 * `dynamic` tells callers that the details could not be read exactly.
 */
export function detectConfigRequirements(text: string): ConfigRequirements {
  const masked = maskComments(text)
  const key = (name: string) => new RegExp(`(?:^|[\\s{,])['"\`]?${name}['"\`]?\\s*(?::|,|\\})`).test(masked)
  const literal = (name: string) => new RegExp(`(?:^|[\\s{,])['"\`]?${name}['"\`]?\\s*:\\s*\\{`).test(masked)
  const playwright = key('playwright')
  const k6 = key('k6')
  const browser = /\bbrowser\s*:\s*(["'`])(chromium|firefox|webkit)\1/.exec(masked)?.[2] as ConfigRequirements['browser'] | undefined
  return {
    playwright,
    k6,
    browser: browser ?? 'chromium',
    dynamic: (playwright && !literal('playwright')) || (k6 && !literal('k6')) || /\bbrowser\s*:\s*(?!["'`])/.test(masked),
  }
}

import { CLIError, ExitCode } from './errors.js'

export const PRIORITIES = ['low', 'medium', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Validate a user-supplied priority (case-insensitive) or throw a config error. */
export function requirePriority(value: string): Priority {
  const normalized = value.trim().toLowerCase()
  if (!(PRIORITIES as readonly string[]).includes(normalized)) {
    throw new CLIError(`Invalid priority "${value}". Use one of: ${PRIORITIES.join(', ')}.`, ExitCode.ConfigError)
  }
  return normalized as Priority
}

import Table from 'cli-table3'
import pc from 'picocolors'
import { logger } from '../utils/logger.js'

export type OutputFormat = 'table' | 'json' | 'quiet'

export type OutputColumn = {
  key: string
  header: string
  width?: number
  format?: (value: unknown, row: Record<string, unknown>) => string
}

let currentFormat: OutputFormat = 'table'

export function setOutputFormat(format: OutputFormat): void {
  currentFormat = format
}

export function getOutputFormat(): OutputFormat {
  return currentFormat
}

/**
 * Format and output data based on the current output format.
 */
export function output<T extends Record<string, unknown>>(
  data: T | T[],
  options?: {
    columns?: OutputColumn[]
  },
): void {
  switch (currentFormat) {
    case 'json':
      logger.output(JSON.stringify(data, null, 2))
      break

    case 'quiet':
      // In quiet mode, only output IDs or minimal info
      if (Array.isArray(data)) {
        for (const item of data) {
          if ('id' in item) logger.output(String(item.id))
        }
      } else if ('id' in data) {
        logger.output(String(data.id))
      }
      break

    case 'table':
    default:
      outputTable(data, options?.columns)
      break
  }
}

function outputTable<T extends Record<string, unknown>>(
  data: T | T[] | undefined | null,
  columns?: OutputColumn[],
): void {
  // Handle undefined/null data
  if (data === undefined || data === null) {
    logger.info('No results found.')
    return
  }

  // Convert to array and filter out undefined/null items
  const rawItems = Array.isArray(data) ? data : [data]
  const items = rawItems.filter((item): item is T => item !== undefined && item !== null)

  if (items.length === 0) {
    logger.info('No results found.')
    return
  }

  // Use provided columns or infer from first item
  const cols: OutputColumn[] = columns ?? Object.keys(items[0]).map((key) => ({
    key,
    header: key.charAt(0).toUpperCase() + key.slice(1),
  }))

  const table = new Table({
    head: cols.map((c) => c.header),
    style: {
      head: ['cyan'],
      border: ['gray'],
    },
  })

  for (const item of items) {
    // Safely access each column value
    table.push(cols.map((c) => formatValue(item?.[c.key], c, item)))
  }

  logger.output(table.toString())
}

/**
 * Status values that should be colorized
 */
const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning'> = {
  // Success states (green)
  up: 'success',
  ok: 'success',
  success: 'success',
  passed: 'success',
  active: 'success',
  sent: 'success',
  enabled: 'success',
  healthy: 'success',
  running: 'success',
  completed: 'success',

  // Error states (red)
  down: 'error',
  failed: 'error',
  error: 'error',
  blocked: 'error',
  unhealthy: 'error',
  cancelled: 'error',
  canceled: 'error',

  // Warning states (yellow)
  paused: 'warning',
  pending: 'warning',
  disabled: 'warning',
  degraded: 'warning',
  unknown: 'warning',
  queued: 'warning',
  warning: 'warning',
  skipped: 'warning',
  inactive: 'warning',
}

/**
 * Format a status value with color and indicator
 */
function formatStatus(status: string): string {
  const normalizedStatus = status.toLowerCase()
  const colorType = STATUS_COLORS[normalizedStatus]

  if (!colorType) {
    return status
  }

  switch (colorType) {
    case 'success':
      return pc.green(`● ${status}`)
    case 'error':
      return pc.red(`● ${status}`)
    case 'warning':
      return pc.yellow(`● ${status}`)
    default:
      return status
  }
}

function formatValue(value: unknown, column?: OutputColumn, row?: Record<string, unknown>): string {
  if (column?.format && row) {
    return column.format(value, row)
  }

  if (value === null || value === undefined) return pc.dim('-')

  if (typeof value === 'boolean') {
    return value ? pc.green('✓') : pc.red('✗')
  }

  if (value instanceof Date) return formatDate(value)

  if (Array.isArray(value)) {
    // If the array contains objects, serialize them as JSON instead of producing [object Object]
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return JSON.stringify(value)
    }
    return value.join(', ')
  }

  if (typeof value === 'number') {
    const dateForNumber = maybeFormatDate(value, column?.key)
    if (dateForNumber) return dateForNumber
    return String(value)
  }

  if (typeof value === 'object') return JSON.stringify(value)

  const strValue = String(value)

  const dateForString = maybeFormatDate(strValue, column?.key)
  if (dateForString) return dateForString

  // Check if this looks like a status value
  if (STATUS_COLORS[strValue.toLowerCase()]) {
    return formatStatus(strValue)
  }

  return strValue
}

const DATE_KEY_PATTERN = /(At|Date|Time|Timestamp)$/i

function maybeFormatDate(value: string | number, key?: string): string | null {
  if (!key && typeof value !== 'string') return null

  if (key && !DATE_KEY_PATTERN.test(key) && typeof value !== 'string') return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  if (typeof value === 'string') {
    const isIsoLike = value.includes('T') || value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value)
    if (!isIsoLike) return null
    return formatDate(date)
  }

  return formatDate(date)
}

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Display pagination info appropriate for the current output format.
 * In JSON mode, pagination is silently skipped (callers should embed it in their JSON).
 * In quiet mode, logger.info is already suppressed.
 * In table mode, shows "Page X/Y (Z total)".
 */
export function outputPagination(
  pagination: { page?: number; currentPage?: number; totalPages: number; total?: number; totalCount?: number } | null | undefined,
): void {
  if (!pagination) return
  if (currentFormat === 'json') return

  const page = pagination.page ?? pagination.currentPage ?? 1
  const total = pagination.total ?? pagination.totalCount ?? 0

  // Don't show pagination when there are no results
  if (total === 0) return

  logger.info(
    `\nPage ${page}/${pagination.totalPages} (${total} total)`,
  )
}

/**
 * Summarize an array of objects for detail view display.
 * Returns a compact string like "3 items" or a key preview for small arrays.
 */
function summarizeArray(_key: string, items: unknown[]): string {
  if (items.length === 0) return pc.dim('(none)')

  // For simple arrays of primitives, join them
  if (typeof items[0] !== 'object' || items[0] === null) {
    return items.join(', ')
  }

  // For arrays of objects, show count + a summary of identifiable fields
  const previews: string[] = []
  for (const item of items.slice(0, 3)) {
    const obj = item as Record<string, unknown>
    // Try common identifier fields
    const name = obj.name ?? obj.title ?? obj.key ?? obj.id
    if (name) previews.push(String(name))
  }

  const countStr = `${items.length} ${items.length === 1 ? 'item' : 'items'}`
  if (previews.length === 0) return countStr
  const previewStr = previews.join(', ')
  return items.length > 3
    ? `${countStr} (${previewStr}, ...)`
    : `${countStr} (${previewStr})`
}

/**
 * Output a single key-value pair detail view.
 *
 * Nested objects are rendered as indented sub-sections.
 * Arrays of objects show a summary count with identifiers.
 */
export function outputDetail(data: Record<string, unknown>): void {
  if (currentFormat === 'json') {
    logger.output(JSON.stringify(data, null, 2))
    return
  }

  if (currentFormat === 'quiet') {
    if ('id' in data) logger.output(String(data.id))
    return
  }

  const keys = Object.keys(data)
  if (keys.length === 0) {
    logger.info('No details available.')
    return
  }

  // Separate scalar/simple fields from nested complex fields
  const scalarEntries: [string, unknown][] = []
  const nestedEntries: [string, Record<string, unknown>][] = []

  for (const [key, value] of Object.entries(data)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      nestedEntries.push([key, value as Record<string, unknown>])
    } else {
      scalarEntries.push([key, value])
    }
  }

  // Render scalar fields first
  if (scalarEntries.length > 0) {
    const maxKeyLen = Math.max(...scalarEntries.map(([k]) => k.length))
    for (const [key, value] of scalarEntries) {
      const label = key.padEnd(maxKeyLen + 2)
      let formatted: string
      if (Array.isArray(value)) {
        formatted = summarizeArray(key, value)
      } else {
        formatted = formatValue(value, { key, header: key }, data)
      }
      logger.output(`  ${label}${formatted}`)
    }
  }

  // Render nested objects as indented sub-sections
  for (const [key, obj] of nestedEntries) {
    logger.output('')
    logger.output(`  ${pc.bold(key)}:`)
    const subKeys = Object.keys(obj)
    if (subKeys.length === 0) {
      logger.output(`    ${pc.dim('(empty)')}`)
      continue
    }
    const maxSubKeyLen = Math.max(...subKeys.map((k) => k.length))
    for (const [subKey, subVal] of Object.entries(obj)) {
      const subLabel = subKey.padEnd(maxSubKeyLen + 2)
      let formatted: string
      if (Array.isArray(subVal)) {
        formatted = summarizeArray(subKey, subVal)
      } else {
        formatted = formatValue(subVal, { key: subKey, header: subKey }, obj)
      }
      logger.output(`    ${subLabel}${formatted}`)
    }
  }
}

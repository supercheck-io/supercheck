import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail, outputMutation, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { withSpinner } from '../utils/spinner.js'
import { requirePriority } from '../utils/priority.js'
import { isUuid } from '../utils/tag-assignment.js'
import { parseIntStrict } from '../utils/number.js'
import { fetchRequirementListItems } from '../utils/resources.js'

interface RequirementDto {
  id: string
  title: string
  description: string | null
  priority: string | null
  tags: string[]
  externalId: string | null
  externalUrl: string | null
  testIds: string[]
  coverage: {
    status: string
    linkedTestCount: number
    passedTestCount: number
    failedTestCount: number
    lastEvaluatedAt: string | null
  } | null
  createdAt: string | null
  updatedAt: string | null
}

const COVERAGE_STATUSES = ['covered', 'failing', 'missing'] as const

/** Repeatable option that also accepts comma-separated values. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, ...value.split(',').map((item) => item.trim()).filter(Boolean)]
}

function requireId(id: string, what = 'requirement'): string {
  if (!isUuid(id)) throw new CLIError(`"${id}" is not a valid ${what} ID (expected a UUID).`, ExitCode.ConfigError)
  return id
}

function requireTestIds(ids: string[]): string[] {
  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new CLIError('At least one test ID is required.', ExitCode.ConfigError)
  if (unique.length > 100) throw new CLIError('At most 100 test IDs can be sent at once.', ExitCode.ConfigError)
  for (const id of unique) requireId(id, 'test')
  return unique
}

function requireTags(tags: string[]): string[] {
  const unique = [...new Set(tags.map((tag) => tag.trim().toLowerCase()))]
  if (unique.length > 10) throw new CLIError('A requirement can have at most 10 tags.', ExitCode.ConfigError)
  if (unique.some((tag) => tag.length > 50)) throw new CLIError('Tag names must be at most 50 characters.', ExitCode.ConfigError)
  return unique
}

function detail(requirement: RequirementDto): Record<string, unknown> {
  const { coverage, ...rest } = requirement
  return {
    ...rest,
    coverageStatus: coverage?.status ?? 'missing',
    linkedTestCount: coverage?.linkedTestCount ?? requirement.testIds.length,
    passedTestCount: coverage?.passedTestCount ?? 0,
    failedTestCount: coverage?.failedTestCount ?? 0,
    lastEvaluatedAt: coverage?.lastEvaluatedAt ?? null,
  }
}

interface FieldOptions {
  title?: string
  description?: string
  priority?: string
  tag: string[]
  externalId?: string
  externalUrl?: string
  test: string[]
}

function addFieldOptions(command: Command): Command {
  return command
    .option('--description <text>', 'Requirement description')
    .option('--priority <priority>', 'Requirement priority (low, medium, high)')
    .option('--tag <name>', 'Tag name (repeatable or comma-separated; replaces the tag set)', collect, [] as string[])
    .option('--external-id <id>', 'ID in an external tracker')
    .option('--external-url <url>', 'URL in an external tracker')
    .option('--test <id>', 'Linked test ID (repeatable or comma-separated; replaces the linked set)', collect, [] as string[])
}

function buildBody(options: FieldOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (options.title !== undefined) {
    if (!options.title.trim() || options.title.length > 500) throw new CLIError('Title must be 1–500 characters.', ExitCode.ConfigError)
    body.title = options.title
  }
  if (options.description !== undefined) body.description = options.description
  if (options.priority !== undefined) body.priority = requirePriority(options.priority)
  if (options.tag.length > 0) body.tags = requireTags(options.tag)
  if (options.externalId !== undefined) body.externalId = options.externalId
  if (options.externalUrl !== undefined) body.externalUrl = options.externalUrl
  if (options.test.length > 0) body.testIds = requireTestIds(options.test)
  return body
}

export const requirementCommand = new Command('requirement')
  .alias('requirements')
  .description('Manage requirements and their test coverage')

requirementCommand
  .command('list')
  .description('List requirements')
  .option('--search <text>', 'Filter by title or description')
  .option('--priority <priority>', 'Filter by priority (low, medium, high)')
  .option('--status <status>', `Filter by coverage status (${COVERAGE_STATUSES.join(', ')})`)
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Items per page', '50')
  .action(async (options: { search?: string; priority?: string; status?: string; page: string; pageSize: string }) => {
    const client = createAuthenticatedClient()
    const params: Record<string, string> = {
      page: String(parseIntStrict(options.page, '--page', { min: 1 })),
      pageSize: String(parseIntStrict(options.pageSize, '--page-size', { min: 1, max: 500 })),
    }
    if (options.search) params.search = options.search
    if (options.priority) params.priority = requirePriority(options.priority)
    if (options.status) {
      if (!(COVERAGE_STATUSES as readonly string[]).includes(options.status)) {
        throw new CLIError(`Invalid status "${options.status}". Use one of: ${COVERAGE_STATUSES.join(', ')}.`, ExitCode.ConfigError)
      }
      params.status = options.status
    }

    const { data } = await withSpinner('Fetching requirements', () => client.get<{
      data?: Record<string, unknown>[]
      requirements?: Record<string, unknown>[]
      total?: number
      page?: number
      pageSize?: number
    }>('/api/requirements', params))

    const rows = data.data ?? data.requirements ?? []
    output(rows, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'title', header: 'Title' },
        { key: 'priority', header: 'Priority' },
        { key: 'coverageStatus', header: 'Coverage' },
        { key: 'linkedTestCount', header: 'Tests' },
      ],
    })
    const total = data.total ?? rows.length
    const size = data.pageSize ?? Number(params.pageSize)
    outputPagination({ page: data.page ?? Number(params.page), total, totalPages: Math.max(1, Math.ceil(total / size)) })
  })

requirementCommand
  .command('get <id>')
  .description('Get a requirement with its tags, linked tests and coverage')
  .action(async (id: string) => {
    requireId(id)
    const client = createAuthenticatedClient()
    const { data } = await withSpinner('Fetching requirement', () => client.get<{ requirement: RequirementDto }>(`/api/requirements/${id}`))
    outputDetail(detail(data.requirement))
  })

addFieldOptions(
  requirementCommand
    .command('create')
    .description('Create a requirement')
    .requiredOption('--title <title>', 'Requirement title (1–500 characters)'),
).action(async (options: FieldOptions) => {
  const body = buildBody(options)
  const client = createAuthenticatedClient()
  const { data } = await withSpinner('Creating requirement', () => client.post<{ requirement: RequirementDto }>('/api/requirements', body))
  logger.success(`Requirement "${data.requirement.title}" created (${data.requirement.id})`)
  outputMutation({ ...detail(data.requirement), action: 'created' })
})

addFieldOptions(
  requirementCommand
    .command('update <id>')
    .description('Update a requirement; only the given fields change')
    .option('--title <title>', 'New title')
    .option('--clear-tags', 'Remove all tags')
    .option('--clear-tests', 'Unlink all tests'),
).action(async (id: string, options: FieldOptions & { clearTags?: boolean; clearTests?: boolean }) => {
  requireId(id)
  if (options.clearTags && options.tag.length > 0) throw new CLIError('Use either --tag or --clear-tags, not both.', ExitCode.ConfigError)
  if (options.clearTests && options.test.length > 0) throw new CLIError('Use either --test or --clear-tests, not both.', ExitCode.ConfigError)
  const body = buildBody(options)
  if (options.clearTags) body.tags = []
  if (options.clearTests) body.testIds = []
  if (Object.keys(body).length === 0) throw new CLIError('Nothing to update. Pass at least one field option.', ExitCode.ConfigError)
  const client = createAuthenticatedClient()
  const { data } = await withSpinner('Updating requirement', () => client.put<{ requirement: RequirementDto }>(`/api/requirements/${id}`, body))
  logger.success(`Requirement ${id} updated`)
  outputMutation({ ...detail(data.requirement), action: 'updated' })
})

requirementCommand
  .command('delete <id>')
  .description('Delete a requirement')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    requireId(id)
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Delete requirement ${id}?`, { default: false })
    }
    const client = createAuthenticatedClient()
    await withSpinner('Deleting requirement', () => client.delete(`/api/requirements/${id}`))
    logger.success(`Requirement ${id} deleted`)
    outputMutation({ id, deleted: true })
  })

requirementCommand
  .command('link <id> <testIds...>')
  .description('Link tests to a requirement (adds to the existing links)')
  .action(async (id: string, testIds: string[]) => {
    requireId(id)
    const ids = requireTestIds(testIds)
    const client = createAuthenticatedClient()
    const { data } = await withSpinner('Linking tests', () => client.post<{ requirement: RequirementDto }>(`/api/requirements/${id}/tests`, { testIds: ids }))
    logger.success(`Linked ${ids.length} test(s) to requirement ${id}`)
    outputMutation({ ...detail(data.requirement), action: 'linked' })
  })

requirementCommand
  .command('unlink <id> <testIds...>')
  .description('Unlink tests from a requirement')
  .action(async (id: string, testIds: string[]) => {
    requireId(id)
    const ids = requireTestIds(testIds)
    const client = createAuthenticatedClient()
    const { data } = await withSpinner('Unlinking tests', () => client.delete<{ requirement: RequirementDto }>(`/api/requirements/${id}/tests`, { testIds: ids }))
    logger.success(`Unlinked ${ids.length} test(s) from requirement ${id}`)
    outputMutation({ ...detail(data.requirement), action: 'unlinked' })
  })

requirementCommand
  .command('coverage [id]')
  .description('Show coverage for one requirement, or a summary by status for all')
  .action(async (id: string | undefined) => {
    const client = createAuthenticatedClient()
    if (id) {
      requireId(id)
      const { data } = await withSpinner('Fetching coverage', () => client.get<{ requirement: RequirementDto }>(`/api/requirements/${id}`))
      const requirement = data.requirement
      outputDetail({
        id: requirement.id,
        title: requirement.title,
        status: requirement.coverage?.status ?? 'missing',
        linkedTestCount: requirement.coverage?.linkedTestCount ?? requirement.testIds.length,
        passedTestCount: requirement.coverage?.passedTestCount ?? 0,
        failedTestCount: requirement.coverage?.failedTestCount ?? 0,
        lastEvaluatedAt: requirement.coverage?.lastEvaluatedAt ?? null,
      })
      return
    }

    const items = await withSpinner('Fetching requirements', () => fetchRequirementListItems(client))
    const counts: Record<string, number> = { covered: 0, failing: 0, missing: 0 }
    for (const item of items) {
      const status = typeof item.coverageStatus === 'string' ? item.coverageStatus : 'missing'
      counts[status] = (counts[status] ?? 0) + 1
    }
    output(
      Object.entries(counts).map(([status, count]) => ({ status, count })),
      { columns: [{ key: 'status', header: 'Coverage' }, { key: 'count', header: 'Requirements' }] },
    )
    logger.info(`${items.length} requirement(s) in total`)
  })

requirementCommand
  .command('export')
  .description('Export requirements as CSV (to stdout, or to a file with --output)')
  .option('--output <file>', 'Write the CSV to this file')
  .option('--force', 'Overwrite --output if it already exists')
  .action(async (options: { output?: string; force?: boolean }) => {
    const client = createAuthenticatedClient()
    const { data: csv } = await withSpinner('Exporting requirements', () => client.getText('/api/requirements/export'))
    if (!options.output) {
      logger.output(csv.replace(/\r?\n$/, ''))
      return
    }
    try {
      writeFileSync(options.output, csv, { flag: options.force ? 'w' : 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new CLIError(`${options.output} already exists. Use --force to overwrite it.`, ExitCode.ConfigError)
      }
      throw new CLIError(`Could not write ${options.output}: ${error instanceof Error ? error.message : String(error)}`, ExitCode.GeneralError)
    }
    logger.success(`Requirements exported to ${options.output}`)
    outputMutation({ file: options.output, bytes: Buffer.byteLength(csv) })
  })

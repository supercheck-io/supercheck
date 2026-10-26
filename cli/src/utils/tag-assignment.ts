import type { ApiClient } from '../api/client.js'
import { ApiRequestError, CLIError, ExitCode } from './errors.js'

export interface AssignedTag {
  id: string
  name: string
  color?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resolves tag references (UUID or exact name) against the project's tags. Unknown references are a config error. */
export async function resolveTagIds(client: ApiClient, refs: string[], opts: { ignoreUnknown?: boolean } = {}): Promise<string[]> {
  const { data } = await client.get<AssignedTag[]>('/api/tags')
  const tags = Array.isArray(data) ? data : []
  const ids = refs.flatMap((ref) => {
    const match = findTag(tags, ref)
    if (!match) {
      if (opts.ignoreUnknown) return []
      throw new CLIError(
        `Tag "${ref}" does not exist in this project. Create it with \`supercheck tag create\` or declare it under \`tags\` in the config.`,
        ExitCode.ConfigError,
      )
    }
    return [match.id]
  })
  return [...new Set(ids)]
}

/** `resourcePath` is the tagged entity, e.g. `/api/tests/<id>`. */
export async function getAssignedTags(client: ApiClient, resourcePath: string): Promise<AssignedTag[]> {
  const { data } = await client.get<AssignedTag[] | { tags?: AssignedTag[] }>(`${resourcePath}/tags`)
  return Array.isArray(data) ? data : (data.tags ?? [])
}

/** Replaces the entity's tag set (the tags endpoints' POST semantics). */
export async function setAssignedTags(client: ApiClient, resourcePath: string, tagIds: string[]): Promise<AssignedTag[]> {
  const { data } = await client.post<AssignedTag[] | { tags?: AssignedTag[] }>(`${resourcePath}/tags`, { tagIds })
  return Array.isArray(data) ? data : (data.tags ?? [])
}

/** Atomic server-side add/remove (PATCH). A 405 means an older server: fall back to read-then-replace. */
async function patchAssignedTags(
  client: ApiClient,
  resourcePath: string,
  patch: { add?: string[]; remove?: string[] },
  fallback: (current: string[]) => string[],
): Promise<AssignedTag[]> {
  try {
    const { data } = await client.patch<AssignedTag[] | { tags?: AssignedTag[] }>(`${resourcePath}/tags`, patch)
    return Array.isArray(data) ? data : (data.tags ?? [])
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.statusCode === 405)) throw error
    const current = await getAssignedTags(client, resourcePath)
    return setAssignedTags(client, resourcePath, fallback(current.map((t) => t.id)))
  }
}

export async function addAssignedTags(client: ApiClient, resourcePath: string, refs: string[]): Promise<AssignedTag[]> {
  const wanted = await resolveTagIds(client, refs)
  return patchAssignedTags(client, resourcePath, { add: wanted }, (current) => [...new Set([...current, ...wanted])])
}

/** Tags that do not exist in the project cannot be assigned, so removing them is a no-op. */
export async function removeAssignedTags(client: ApiClient, resourcePath: string, refs: string[]): Promise<AssignedTag[]> {
  const unwanted = await resolveTagIds(client, refs, { ignoreUnknown: true })
  if (unwanted.length === 0) return getAssignedTags(client, resourcePath)
  return patchAssignedTags(client, resourcePath, { remove: unwanted }, (current) => current.filter((id) => !unwanted.includes(id)))
}

/** Find a tag by id, exact name, or (as a fallback) case-insensitive name; the server keeps the stored spelling. */
export function findTag<T extends { id: string; name: string }>(tags: T[], ref: string): T | undefined {
  return tags.find((tag) => tag.id === ref || tag.name === ref)
    ?? tags.find((tag) => tag.name.toLowerCase() === ref.trim().toLowerCase())
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

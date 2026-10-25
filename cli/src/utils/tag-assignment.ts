import type { ApiClient } from '../api/client.js'
import { CLIError, ExitCode } from './errors.js'

export interface AssignedTag {
  id: string
  name: string
  color?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resolves tag references (UUID or exact name) against the project's tags. Unknown references are a config error. */
export async function resolveTagIds(client: ApiClient, refs: string[]): Promise<string[]> {
  const { data } = await client.get<AssignedTag[]>('/api/tags')
  const tags = Array.isArray(data) ? data : []
  const ids = refs.map((ref) => {
    // Exact name or id first; fall back to a case-insensitive name match (the server keeps the stored spelling).
    const match = tags.find((tag) => tag.id === ref || tag.name === ref)
      ?? tags.find((tag) => tag.name.toLowerCase() === ref.trim().toLowerCase())
    if (!match) {
      throw new CLIError(
        `Tag "${ref}" does not exist in this project. Create it with \`supercheck tag create\` or declare it under \`tags\` in the config.`,
        ExitCode.ConfigError,
      )
    }
    return match.id
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

export async function addAssignedTags(client: ApiClient, resourcePath: string, refs: string[]): Promise<AssignedTag[]> {
  const [current, wanted] = await Promise.all([getAssignedTags(client, resourcePath), resolveTagIds(client, refs)])
  return setAssignedTags(client, resourcePath, [...new Set([...current.map((t) => t.id), ...wanted])])
}

export async function removeAssignedTags(client: ApiClient, resourcePath: string, refs: string[]): Promise<AssignedTag[]> {
  const [current, unwanted] = await Promise.all([getAssignedTags(client, resourcePath), resolveTagIds(client, refs)])
  return setAssignedTags(client, resourcePath, current.map((t) => t.id).filter((id) => !unwanted.includes(id)))
}

/** Find a tag by id, exact name, or (as a fallback) case-insensitive name. */
export function findTag<T extends { id: string; name: string }>(tags: T[], ref: string): T | undefined {
  return tags.find((tag) => tag.id === ref || tag.name === ref)
    ?? tags.find((tag) => tag.name.toLowerCase() === ref.trim().toLowerCase())
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

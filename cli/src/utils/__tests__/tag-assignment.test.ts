import { describe, expect, it, jest } from '@jest/globals'
import type { ApiClient } from '../../api/client.js'
import { addAssignedTags, getAssignedTags, removeAssignedTags, resolveTagIds } from '../tag-assignment.js'

const PROJECT_TAGS = [
  { id: 't-smoke', name: 'Smoke' },
  { id: 't-web', name: 'web' },
  { id: 't-api', name: 'api' },
]

function fakeClient(assigned: Array<{ id: string; name: string }> | { tags: Array<{ id: string; name: string }> }) {
  const post = jest.fn(async (_path: string, body: { tagIds: string[] }) => ({
    data: PROJECT_TAGS.filter((tag) => body.tagIds.includes(tag.id)),
  }))
  const get = jest.fn(async (path: string) => ({ data: path === '/api/tags' ? PROJECT_TAGS : assigned }))
  return { client: { get, post } as unknown as ApiClient, get, post }
}

describe('tag assignment', () => {
  it('resolves ids, exact names and case-insensitive names, deduplicated', async () => {
    const { client } = fakeClient([])
    await expect(resolveTagIds(client, ['t-api', 'Smoke', ' WEB ', 'smoke'])).resolves.toEqual(['t-api', 't-smoke', 't-web'])
  })

  it('rejects an unknown tag as a config error before any write', async () => {
    const { client, post } = fakeClient([])
    await expect(addAssignedTags(client, '/api/tests/x', ['missing'])).rejects.toThrow('Tag "missing" does not exist')
    expect(post).not.toHaveBeenCalled()
  })

  it('accepts both the array and the { tags } response shapes', async () => {
    await expect(getAssignedTags(fakeClient([{ id: 't-web', name: 'web' }]).client, '/api/tests/x')).resolves.toHaveLength(1)
    await expect(getAssignedTags(fakeClient({ tags: [{ id: 't-web', name: 'web' }] }).client, '/api/tests/x')).resolves.toHaveLength(1)
  })

  it('add keeps existing tags and posts the merged set once', async () => {
    const { client, post } = fakeClient([{ id: 't-web', name: 'web' }])
    const result = await addAssignedTags(client, '/api/tests/x', ['smoke', 'web'])
    expect(post).toHaveBeenCalledWith('/api/tests/x/tags', { tagIds: ['t-web', 't-smoke'] })
    expect(result.map((tag) => tag.id)).toEqual(['t-smoke', 't-web'])
  })

  it('remove drops only the named tags', async () => {
    const { client, post } = fakeClient([{ id: 't-web', name: 'web' }, { id: 't-api', name: 'api' }])
    await removeAssignedTags(client, '/api/tests/x', ['WEB'])
    expect(post).toHaveBeenCalledWith('/api/tests/x/tags', { tagIds: ['t-api'] })
  })
})

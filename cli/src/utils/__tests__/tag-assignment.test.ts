import { describe, expect, it, jest } from '@jest/globals'
import type { ApiClient } from '../../api/client.js'
import { ApiRequestError } from '../errors.js'
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
  const patch = jest.fn(async (_path: string, body: { add?: string[]; remove?: string[] }) => ({
    data: PROJECT_TAGS.filter((tag) => (body.add ?? []).includes(tag.id)),
  }))
  return { client: { get, post, patch } as unknown as ApiClient, get, post, patch }
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

  it('add sends one atomic PATCH without reading the current set', async () => {
    const { client, post, patch, get } = fakeClient([{ id: 't-web', name: 'web' }])
    const result = await addAssignedTags(client, '/api/tests/x', ['smoke', 'web'])
    expect(patch).toHaveBeenCalledWith('/api/tests/x/tags', { add: ['t-smoke', 't-web'] })
    expect(get).not.toHaveBeenCalledWith('/api/tests/x/tags')
    expect(post).not.toHaveBeenCalled()
    expect(result.map((tag) => tag.id)).toEqual(['t-smoke', 't-web'])
  })

  it('remove sends a PATCH with only the named tags', async () => {
    const { client, patch } = fakeClient([])
    await removeAssignedTags(client, '/api/tests/x', ['WEB'])
    expect(patch).toHaveBeenCalledWith('/api/tests/x/tags', { remove: ['t-web'] })
  })

  it('remove of an unknown tag is a no-op that returns the current set', async () => {
    const { client, patch, post } = fakeClient([{ id: 't-web', name: 'web' }])
    await expect(removeAssignedTags(client, '/api/tests/x', ['missing'])).resolves.toEqual([{ id: 't-web', name: 'web' }])
    expect(patch).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('falls back to read-then-replace on an old server (405)', async () => {
    const { client, post, patch } = fakeClient([{ id: 't-web', name: 'web' }, { id: 't-api', name: 'api' }])
    patch.mockRejectedValue(new ApiRequestError('Method not allowed', 405))
    await addAssignedTags(client, '/api/tests/x', ['smoke'])
    expect(post).toHaveBeenLastCalledWith('/api/tests/x/tags', { tagIds: ['t-web', 't-api', 't-smoke'] })
    await removeAssignedTags(client, '/api/tests/x', ['web'])
    expect(post).toHaveBeenLastCalledWith('/api/tests/x/tags', { tagIds: ['t-api'] })
  })

  it('rethrows non-405 errors from the PATCH', async () => {
    const { client, patch, post } = fakeClient([])
    patch.mockRejectedValue(new ApiRequestError('Forbidden', 403))
    await expect(addAssignedTags(client, '/api/tests/x', ['smoke'])).rejects.toThrow('Forbidden')
    expect(post).not.toHaveBeenCalled()
  })
})

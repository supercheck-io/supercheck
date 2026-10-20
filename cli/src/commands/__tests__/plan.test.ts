import { describe, it, expect } from '@jest/globals'
import { readPlan } from '../plan.js'

const clientFor = (data: Record<string, unknown>) => ({ get: async () => ({ data }) }) as never

describe('readPlan', () => {
  it('reports active and inactive explicitly', async () => {
    expect(await readPlan(clientFor({ isActive: true, plan: 'pro' }))).toMatchObject({ state: 'active' })
    expect(await readPlan(clientFor({ isActive: false }))).toMatchObject({ state: 'inactive', action: expect.any(String) })
  })

  it('never maps a missing isActive to inactive', async () => {
    const out = await readPlan(clientFor({ plan: null }))
    expect(out.state).toBe('unknown')
    expect(out).not.toHaveProperty('action')
  })
})

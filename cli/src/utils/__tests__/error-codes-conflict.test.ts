import { describe, it, expect } from '@jest/globals'
import { classifyError } from '../error-codes.js'
import { ApiRequestError } from '../errors.js'

describe('classifyError', () => {
  it('gives a duplicate (409) a stable CONFLICT code', () => {
    expect(classifyError(new ApiRequestError('exists', 409))?.code).toBe('CONFLICT')
  })
})

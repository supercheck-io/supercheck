import {
  isMutableImageReference,
  parseImagePullPolicyOverride,
} from './image-reference';

describe('isMutableImageReference', () => {
  it.each([
    'ghcr.io/supercheck-io/supercheck/worker:latest',
    'supercheck/worker:latest',
    'worker',
    'ghcr.io/supercheck-io/supercheck/worker',
    'registry.internal:5000/supercheck/worker',
    '',
    '   ',
  ])('treats %s as mutable', (reference) => {
    expect(isMutableImageReference(reference)).toBe(true);
  });

  it.each([
    'ghcr.io/supercheck-io/supercheck/worker:1.3.6',
    'supercheck/worker:1.3.7-rc.1',
    'registry.internal:5000/supercheck/worker:1.3.6',
    'ghcr.io/supercheck-io/supercheck/worker@sha256:abc123',
    'ghcr.io/supercheck-io/supercheck/worker:1.3.6@sha256:abc123',
  ])('treats %s as immutable', (reference) => {
    expect(isMutableImageReference(reference)).toBe(false);
  });
});

describe('parseImagePullPolicyOverride', () => {
  it.each([
    ['Always', 'Always'],
    ['always', 'Always'],
    ['  IfNotPresent ', 'IfNotPresent'],
    ['ifnotpresent', 'IfNotPresent'],
    ['Never', 'Never'],
    ['never', 'Never'],
  ] as const)('parses %s as %s', (input, expected) => {
    expect(parseImagePullPolicyOverride(input)).toEqual({ policy: expected });
  });

  it('returns an empty result when no override is supplied', () => {
    expect(parseImagePullPolicyOverride(undefined)).toEqual({});
    expect(parseImagePullPolicyOverride(null)).toEqual({});
    expect(parseImagePullPolicyOverride('   ')).toEqual({});
  });

  it('reports an unrecognized override without resolving a policy', () => {
    expect(parseImagePullPolicyOverride('Sometimes')).toEqual({
      invalidOverride: 'Sometimes',
    });
  });
});

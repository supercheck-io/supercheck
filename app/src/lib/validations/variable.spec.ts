import { createVariableSchema, updateVariableSchema } from './variable';

describe('variable validation schema', () => {
  it('allows create without description', () => {
    const result = createVariableSchema.safeParse({
      key: 'API_KEY',
      value: 'secret-value',
      isSecret: true,
    });

    expect(result.success).toBe(true);
  });

  it('allows empty description on update payload omission pattern', () => {
    const result = updateVariableSchema.safeParse({
      key: 'BASE_URL',
      isSecret: false,
    });

    expect(result.success).toBe(true);
  });

  it('rejects reserved variable keys', () => {
    const result = createVariableSchema.safeParse({
      key: 'NODE_ENV',
      value: 'prod',
      isSecret: false,
    });

    expect(result.success).toBe(false);
  });
});

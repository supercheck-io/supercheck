import { getDatabasePoolMax } from './db-pool';

describe('worker database pool size', () => {
  it('preserves the default and allows a single connection', () => {
    expect(getDatabasePoolMax('')).toBe(10);
    expect(getDatabasePoolMax('1')).toBe(1);
  });

  it.each([
    '0',
    '-1',
    '2.5',
    '10oops',
    ' 10 ',
    'NaN',
    'Infinity',
    '9007199254740992',
  ])('rejects %s before constructing a pool', (value) =>
    expect(() => getDatabasePoolMax(value)).toThrow('DB_POOL_MAX'),
  );
});

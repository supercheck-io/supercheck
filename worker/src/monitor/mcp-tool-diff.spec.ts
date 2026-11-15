import {
  canonicalJson,
  diffTools,
  fingerprintTool,
  hasToolChanges,
  hashToolList,
} from './mcp-tool-diff';

const tool = (
  name: string,
  description = 'does x',
  inputSchema: unknown = { type: 'object' },
) => fingerprintTool({ name, description, inputSchema })!;

describe('canonicalJson', () => {
  it('ignores key order at every level and drops undefined', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }),
    ).toBe(
      canonicalJson({ a: { c: undefined, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson([1, 'a', null])).toBe('[1,"a",null]');
  });
});

describe('fingerprintTool', () => {
  it('stores only printable ASCII in the name but fingerprints the raw name', () => {
    const fp = tool('a\u202eb\nc');
    expect(fp.name).toBe('a?b?c');
    expect(fp.fingerprint).not.toEqual(tool('a?b?c').fingerprint);
  });

  it('is a SHA-256 of the canonical {name, description, inputSchema} plus the part hashes', () => {
    const fp = tool('a');
    expect(fp.name).toBe('a');
    expect(fp.fingerprint).toMatch(/^[0-9a-f]{64}(\.[0-9a-f]{10}){3}$/);
  });

  it('is stable across schema key order and changes with any of the three parts', () => {
    const base = tool('a', 'd', { type: 'object', properties: { x: 1, y: 2 } });
    expect(
      tool('a', 'd', { properties: { y: 2, x: 1 }, type: 'object' }),
    ).toEqual(base);
    expect(
      tool('b', 'd', { type: 'object', properties: { x: 1, y: 2 } })
        .fingerprint,
    ).not.toBe(base.fingerprint);
    expect(
      tool('a', 'e', { type: 'object', properties: { x: 1, y: 2 } })
        .fingerprint,
    ).not.toBe(base.fingerprint);
    expect(tool('a', 'd', { type: 'object' }).fingerprint).not.toBe(
      base.fingerprint,
    );
  });

  it('treats a missing description and schema as empty and null', () => {
    const fp = fingerprintTool({ name: 'a' })!;
    expect(fp).toEqual(
      fingerprintTool({ name: 'a', description: '', inputSchema: null }),
    );
  });

  it('clips long names to 128 characters and rejects entries without a name', () => {
    expect(fingerprintTool({ name: 'n'.repeat(300) })!.name).toHaveLength(128);
    for (const bad of [null, 'x', 5, {}, { name: '' }, { name: 3 }])
      expect(fingerprintTool(bad)).toBeNull();
  });

  it('never carries the description or schema text', () => {
    const fp = tool('a', 'SECRET-DESCRIPTION', { secret: 'SECRET-SCHEMA' });
    expect(JSON.stringify(fp)).not.toMatch(/SECRET/);
  });
});

describe('hashToolList', () => {
  it('does not depend on the order tools are listed in', () => {
    const a = tool('a');
    const b = tool('b');
    expect(hashToolList([a, b])).toBe(hashToolList([b, a]));
    expect(hashToolList([a, b])).not.toBe(hashToolList([a]));
    expect(hashToolList([a, b])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('diffTools', () => {
  const list = [tool('a'), tool('b'), tool('c')];

  it('reports nothing for equal lists, and a reorder is not a change', () => {
    const diff = diffTools(list, [list[2], list[0], list[1]]);
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
    expect(hasToolChanges(diff)).toBe(false);
  });

  it('reports added and removed tools by name', () => {
    const diff = diffTools(list, [list[0], tool('d'), tool('e')]);
    expect(diff.added).toEqual(['d', 'e']);
    expect(diff.removed).toEqual(['b', 'c']);
    expect(diff.changed).toEqual([]);
    expect(hasToolChanges(diff)).toBe(true);
  });

  it('names the reason: description only, schema only, or both', () => {
    const before = [tool('a'), tool('b'), tool('c')];
    const after = [
      tool('a', 'new text'),
      tool('b', 'does x', { type: 'object', properties: { q: {} } }),
      tool('c', 'new text', { type: 'array' }),
    ];
    expect(diffTools(before, after).changed).toEqual([
      { name: 'a', reasons: ['description'] },
      { name: 'b', reasons: ['schema'] },
      { name: 'c', reasons: ['description', 'schema'] },
    ]);
  });

  it('reports both reasons for a baseline written without part hashes', () => {
    const old = [{ name: 'a', fingerprint: 'f'.repeat(64) }];
    expect(diffTools(old, [tool('a')]).changed).toEqual([
      { name: 'a', reasons: ['description', 'schema'] },
    ]);
  });

  it('reports both reasons when only the whole hash differs', () => {
    const a = {
      name: 'a',
      fingerprint: `${'1'.repeat(64)}.aaaaaaaaaa.bbbbbbbbbb`,
    };
    const b = {
      name: 'a',
      fingerprint: `${'2'.repeat(64)}.aaaaaaaaaa.bbbbbbbbbb`,
    };
    expect(diffTools([a], [b]).changed[0].reasons).toEqual([
      'description',
      'schema',
    ]);
  });

  it('keeps two raw names that sanitise to the same display distinct', () => {
    const a = tool('résumé');
    const b = tool('r?sum?');
    expect(a.name).toBe(b.name);
    const diff = diffTools([a], [a, b]);
    expect(diff.added).toEqual(['r?sum?']);
    expect(diffTools([a, b], [a]).removed).toEqual(['r?sum?']);
    expect(diffTools([a, b], [a, b])).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });
});

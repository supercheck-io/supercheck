/**
 * Contract tests for the jsdom Fetch primitives installed by jest.setup.ts.
 *
 * Application code reads `response.ok`, clones responses and reads combined
 * headers, so a stub that returns `undefined` there (or overwrites repeated
 * headers) sends tests down paths production never takes. These assertions fail
 * if the stubs drift from the Fetch behaviour the app depends on.
 */

describe('jsdom Fetch primitives installed by jest.setup.ts', () => {
  it('joins repeated header values with a comma instead of overwriting them', () => {
    const headers = new Headers();
    headers.append('Set-Cookie', 'a=1');
    headers.append('set-cookie', 'b=2');

    expect(headers.get('SET-COOKIE')).toBe('a=1, b=2');
    expect(headers.has('set-cookie')).toBe(true);
  });

  it('replaces rather than appends with set(), and normalises header names', () => {
    const headers = new Headers({ 'Content-Type': 'text/plain' });
    headers.set('content-type', 'application/json');

    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('copies headers through the constructor and remains iterable', () => {
    const source = new Headers();
    source.append('X-Trace', 'one');
    source.append('X-Trace', 'two');

    const copy = new Headers(source);
    expect(copy.get('x-trace')).toBe('one, two');
    expect([...copy.keys()]).toEqual(['x-trace']);
    expect(Object.fromEntries(copy.entries())).toEqual({ 'x-trace': 'one, two' });
  });

  it('reports ok for success statuses and not for error statuses', () => {
    expect(new Response('body', { status: 200 }).ok).toBe(true);
    expect(new Response('body', { status: 204 }).ok).toBe(true);
    expect(new Response('body', { status: 301 }).ok).toBe(false);
    expect(new Response('body', { status: 404 }).ok).toBe(false);
    expect(new Response('body', { status: 500 }).ok).toBe(false);
  });

  it('defaults status to 200 and statusText to an empty string', () => {
    const response = new Response('body');

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('');
  });

  it('clones body, status and headers without sharing header state', async () => {
    const response = new Response('payload', {
      status: 201,
      statusText: 'Created',
      headers: { 'Content-Type': 'text/plain' },
    });

    const clone = response.clone();
    clone.headers.set('Content-Type', 'application/json');

    expect(clone.status).toBe(201);
    expect(clone.statusText).toBe('Created');
    await expect(clone.text()).resolves.toBe('payload');
    expect(response.headers.get('Content-Type')).toBe('text/plain');
  });

  it('serialises JSON responses with a JSON content type', async () => {
    const response = Response.json({ error: 'nope' }, { status: 400 });

    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'nope' });
  });
});

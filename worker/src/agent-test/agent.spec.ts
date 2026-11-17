import * as http from 'http';
import type { AddressInfo } from 'net';
import { createAgent, newState } from './agent';

describe('agent.repeat', () => {
  afterEach(() => jest.useRealTimers());

  it('counts passes and lists failures by attempt without throwing', async () => {
    const agent = createAgent(newState());
    let calls = 0;
    const r = await agent.repeat(5, async () => {
      calls++;
      if (calls === 2) throw new Error('boom');
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a script may throw a string
      if (calls === 4) throw 'plain string';
      if (calls === 5) throw new Error('\u001b[31mred\u001b[39m');
    });
    expect(r).toEqual({
      attempts: 5,
      passed: 2,
      failed: 3,
      passRate: 0.4,
      failures: [
        { attempt: 2, message: 'boom' },
        { attempt: 4, message: 'plain string' },
        { attempt: 5, message: 'red' },
      ],
    });
  });

  it.each([
    [0, undefined],
    [21, undefined],
    [1.5, undefined],
    [3, 0],
    [3, 6],
    [3, 1.5],
  ])('rejects n=%s concurrency=%s', async (n, concurrency) => {
    await expect(
      createAgent(newState()).repeat(n, async () => undefined, { concurrency }),
    ).rejects.toThrow(RangeError);
  });

  it('accepts the bounds 1, 20 and concurrency 5', async () => {
    const agent = createAgent(newState());
    expect((await agent.repeat(1, async () => undefined)).passRate).toBe(1);
    const r = await agent.repeat(20, async () => undefined, { concurrency: 5 });
    expect(r.attempts).toBe(20);
  });

  it('never runs more than `concurrency` attempts at once', async () => {
    jest.useFakeTimers();
    let running = 0;
    let max = 0;
    const done = createAgent(newState()).repeat(
      7,
      async () => {
        max = Math.max(max, ++running);
        await new Promise((r) => setTimeout(r, 100));
        running--;
      },
      { concurrency: 3 },
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect((await done).passed).toBe(7);
    expect(max).toBe(3);
  });

  it('bounds each attempt by the 200 s budget and counts the rest as failed', async () => {
    jest.useFakeTimers();
    const done = createAgent(newState()).repeat(4, async () => {
      await new Promise((r) => setTimeout(r, 120_000));
    });
    await jest.advanceTimersByTimeAsync(400_000);
    const r = await done;
    // attempt 1 ends at 120 s; attempt 2 is cut at 200 s; 3 and 4 never start
    expect(r.passed).toBe(1);
    expect(r.failures).toEqual([
      { attempt: 2, message: 'not finished: time budget used' },
      { attempt: 3, message: 'not run: time budget used' },
      { attempt: 4, message: 'not run: time budget used' },
    ]);
    expect(r.passRate).toBe(0.25);
  });

  it('stops at a run deadline shorter than the 200 s budget (a short trial run)', async () => {
    jest.useFakeTimers();
    const state = newState();
    state.deadlineAt = Date.now() + 50_000;
    const done = createAgent(state).repeat(3, async () => {
      await new Promise((r) => setTimeout(r, 30_000));
    });
    await jest.advanceTimersByTimeAsync(60_000);
    const r = await done;
    // attempt 1 ends at 30 s; attempt 2 is cut at the 50 s deadline; 3 never starts
    expect(r.passed).toBe(1);
    expect(r.failures).toEqual([
      { attempt: 2, message: 'not finished: time budget used' },
      { attempt: 3, message: 'not run: time budget used' },
    ]);
  });

  it('runs nothing when the run deadline has already passed', async () => {
    const state = newState();
    state.deadlineAt = Date.now() - 1;
    const fn = jest.fn();
    const r = await createAgent(state).repeat(2, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(r.failed).toBe(2);
  });

  it('returns even when an attempt never settles, and ignores its late rejection', async () => {
    jest.useFakeTimers();
    let reject!: (e: Error) => void;
    const done = createAgent(newState()).repeat(
      1,
      () => new Promise((_, rej) => (reject = rej)),
    );
    await jest.advanceTimersByTimeAsync(200_000);
    expect((await done).failures).toEqual([
      { attempt: 1, message: 'not finished: time budget used' },
    ]);
    reject(new Error('late')); // would be an unhandled rejection without the guard
    await jest.advanceTimersByTimeAsync(1);
  });

  it('stops an attempt cut by the budget from sending again, so no call is billed after the repeat', async () => {
    jest.useFakeTimers();
    const state = newState();
    const agent = createAgent(state);
    // Port 9 refuses connections: a send that reached fetch would fail with a different error.
    const bot = agent.connect({
      kind: 'http',
      url: 'http://127.0.0.1:9',
      body: (m) => ({ m }),
      reply: 'text',
    });
    let late!: Promise<unknown>;
    const done = agent.repeat(1, async () => {
      await new Promise((r) => setTimeout(r, 250_000));
      late = bot.send('too late');
      await late;
    });
    await jest.advanceTimersByTimeAsync(260_000);
    expect((await done).failures).toEqual([
      { attempt: 1, message: 'not finished: time budget used' },
    ]);
    await expect(late).rejects.toThrow('not sent: time budget used');
    expect(state.sends).toEqual([
      expect.objectContaining({
        attempt: 1,
        error: 'not sent: time budget used',
      }),
    ]);
  });

  it('does not call the judge from an attempt cut by the budget', async () => {
    jest.useFakeTimers();
    const agent = createAgent(newState());
    let late!: Promise<unknown>;
    const done = agent.repeat(1, async () => {
      await new Promise((r) => setTimeout(r, 250_000));
      late = agent.judge('x', 'r', { url: 'http://127.0.0.1:9', model: 'j' });
      await late;
    });
    await jest.advanceTimersByTimeAsync(260_000);
    await done;
    await expect(late).rejects.toThrow('not judged: time budget used');
  });

  it('also stops a nested attempt once its outer attempt ran out of budget', async () => {
    jest.useFakeTimers();
    const agent = createAgent(newState());
    const bot = agent.connect({
      kind: 'http',
      url: 'http://127.0.0.1:9',
      body: (m) => ({ m }),
      reply: 'text',
    });
    let inner!: Promise<{ failures: { message: string }[] }>;
    const done = agent.repeat(1, async () => {
      await new Promise((r) => setTimeout(r, 150_000));
      // The inner repeat gets a fresh 200 s budget, but its parent expires at 200 s.
      inner = agent.repeat(1, async () => {
        await new Promise((r) => setTimeout(r, 100_000));
        await bot.send('nested');
      });
      await inner;
    });
    await jest.advanceTimersByTimeAsync(260_000);
    await done;
    expect((await inner).failures[0].message).toBe(
      'not sent: time budget used',
    );
  });

  it('records partial counts before the repeat ends, so an aborted test still reports them', async () => {
    const state = newState();
    const agent = createAgent(state);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const done = agent.repeat(3, async () => {
      if (++calls === 1) return;
      if (calls === 2) throw new Error('boom');
      await gate;
    });
    await new Promise((r) => setImmediate(r));
    expect(state.repeats[0]).toMatchObject({
      attempts: 3,
      passed: 1,
      failed: 1,
      failures: [{ attempt: 2, message: 'boom' }],
    });
    release();
    await done;
    expect(state.repeats).toHaveLength(1);
    expect(state.repeats[0].passed).toBe(2);
  });

  it('records only a top-level repeat, not one nested in an attempt', async () => {
    const state = newState();
    const agent = createAgent(state);
    let inner: unknown;
    const outer = await agent.repeat(2, async () => {
      inner = await agent.repeat(3, async () => undefined);
    });
    expect(inner).toMatchObject({ attempts: 3, passed: 3 });
    expect(state.repeats).toEqual([outer]);
    expect(outer.attempts).toBe(2);
  });
});

describe('agent.judge', () => {
  let server: http.Server;
  let reply: (res: http.ServerResponse) => void;
  let seen: any[];
  let url: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        reply(res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => (seen = []));

  const answer =
    (content: string, tokens = 7) =>
    (res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: tokens,
          },
        }),
      );
    };

  it('returns the grade, sends the rubric and counts judge tokens separately', async () => {
    const state = newState();
    reply = answer('Sure: {"pass": true, "reason": "mentions 30 days"}');
    const grade = await createAgent(state).judge(
      '30 days',
      'must say 30 days',
      {
        url,
        apiKey: 'judge-key',
        model: 'j',
      },
    );
    expect(grade).toEqual({ pass: true, reason: 'mentions 30 days' });
    expect(seen[0].auth).toBe('Bearer judge-key');
    expect(seen[0].body.model).toBe('j');
    expect(seen[0].body).not.toHaveProperty('temperature');
    expect(JSON.stringify(seen[0].body.messages)).toContain('must say 30 days');
    expect(state.judgeTokens).toBe(7);
    expect(state.sends).toEqual([]); // judge calls are not agent sends
    expect(state.secrets).toContain('judge-key');
  });

  it('adds a judge cost when the judge reports one', async () => {
    const state = newState();
    reply = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"pass": true}' } }],
          usage: { total_tokens: 3, cost: 0.02 },
        }),
      );
    };
    const agent = createAgent(state);
    await agent.judge('x', 'r', { url, model: 'j' });
    await agent.judge('x', 'r', { url, model: 'j' });
    expect(state.judgeCost).toBeCloseTo(0.04);
    reply = answer('{"pass": true}');
    const noCost = newState();
    await createAgent(noCost).judge('x', 'r', { url, model: 'j' });
    expect(noCost.judgeCost).toBeUndefined();
  });

  it('rejects a credential too short to redact, before any request', async () => {
    await expect(
      createAgent(newState()).judge('x', 'r', {
        url,
        apiKey: 'ab',
        model: 'j',
      }),
    ).rejects.toThrow(/^agent\.judge: .*at least/);
    expect(seen).toEqual([]);
  });

  it('returns a failing grade with the reason', async () => {
    reply = answer('{"pass": false, "reason": "no number"}');
    expect(
      await createAgent(newState()).judge('x', 'r', { url, model: 'j' }),
    ).toEqual({ pass: false, reason: 'no number' });
  });

  it.each([
    ['not json at all', 'judge reply was not JSON'],
    ['{"pass": "yes"}', 'judge reply has no boolean "pass"'],
    ['{pass: true,}', 'judge reply was not valid JSON'],
  ])(
    'treats a malformed reply (%s) as a failed grade',
    async (content, reason) => {
      const state = newState();
      reply = answer(content);
      expect(
        await createAgent(state).judge('x', 'r', { url, model: 'j' }),
      ).toEqual({
        pass: false,
        reason,
      });
      expect(state.judgeTokens).toBe(7);
    },
  );

  it('keeps an empty reason when the judge sends none', async () => {
    reply = answer('{"pass": true}');
    expect(
      await createAgent(newState()).judge('x', 'r', { url, model: 'j' }),
    ).toEqual({ pass: true, reason: '' });
  });

  it('throws on an HTTP error from the judge', async () => {
    reply = (res) => {
      res.writeHead(500);
      res.end('down');
    };
    await expect(
      createAgent(newState()).judge('x', 'r', { url, model: 'j' }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('send recording', () => {
  it('records successes and failures with the attempt that made them', async () => {
    const state = newState();
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const fail = JSON.parse(raw).q === 'bad';
        res.writeHead(fail ? 500 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: 'ok' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const agent = createAgent(state);
    const bot = agent.connect({
      kind: 'http',
      url,
      body: (m) => ({ q: m }),
      reply: 'text',
      apiKey: 'key-1234',
      headers: { 'x-token': 'hv-5678' },
    });
    await bot.send('outside');
    await agent.repeat(2, async () => {
      await bot.send('good');
      await bot.send('bad');
    });
    await new Promise((r) => server.close(r));
    expect(
      state.sends.map((s) => [s.attempt, s.prompt, s.error ? 'err' : 'ok']),
    ).toEqual(
      expect.arrayContaining([
        [0, 'outside', 'ok'],
        [1, 'good', 'ok'],
        [1, 'bad', 'err'],
        [2, 'good', 'ok'],
        [2, 'bad', 'err'],
      ]),
    );
    expect(state.secrets).toEqual(['key-1234', 'hv-5678']);
    expect(state.repeats[0].passRate).toBe(0);
  });
});

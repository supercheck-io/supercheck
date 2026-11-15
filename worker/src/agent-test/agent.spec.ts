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

  it('starts no attempt after 200 s and counts the rest as failed', async () => {
    jest.useFakeTimers();
    const done = createAgent(newState()).repeat(4, async () => {
      await new Promise((r) => setTimeout(r, 120_000));
    });
    await jest.advanceTimersByTimeAsync(400_000);
    const r = await done;
    // attempts 1 and 2 start before 200 s; 3 and 4 are not run
    expect(r.passed).toBe(2);
    expect(r.failures).toEqual([
      { attempt: 3, message: 'not run: time budget used' },
      { attempt: 4, message: 'not run: time budget used' },
    ]);
    expect(r.passRate).toBe(0.5);
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
    expect(JSON.stringify(seen[0].body.messages)).toContain('must say 30 days');
    expect(state.judgeTokens).toBe(7);
    expect(state.sends).toEqual([]); // judge calls are not agent sends
    expect(state.secrets).toContain('judge-key');
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
      apiKey: 'k1',
      headers: { h: 'hv' },
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
    expect(state.secrets).toEqual(['k1', 'hv']);
    expect(state.repeats[0].passRate).toBe(0);
  });
});

import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Playwright execution configuration', () => {
  const configPath = path.resolve(__dirname, '../playwright.config.js');
  const originalTrace = process.env.PLAYWRIGHT_TRACE;
  const originalVideo = process.env.PLAYWRIGHT_VIDEO;

  afterEach(() => {
    if (originalTrace === undefined) delete process.env.PLAYWRIGHT_TRACE;
    else process.env.PLAYWRIGHT_TRACE = originalTrace;
    if (originalVideo === undefined) delete process.env.PLAYWRIGHT_VIDEO;
    else process.env.PLAYWRIGHT_VIDEO = originalVideo;
  });

  function loadConfig() {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      const config = require(${JSON.stringify(configPath)});
      const titles = ['plain test', 'test @firefox', 'test @webkit', 'test @mobile'];
      console.log(JSON.stringify({
        use: config.use,
        reporter: config.reporter,
        selected: titles.map(title => config.projects.filter(project =>
          (!project.grep || project.grep.test(title)) &&
          (!project.grepInvert || !project.grepInvert.test(title))
        ).map(project => project.name)),
        allDefault: config.projects.every(project => project.default !== false)
      }));
    `,
      ],
      { encoding: 'utf8', env: process.env },
    );
    return JSON.parse(output.trim().split('\n').at(-1)!);
  }

  it('retains successful retries as well as failures', () => {
    delete process.env.PLAYWRIGHT_TRACE;
    delete process.env.PLAYWRIGHT_VIDEO;
    const config = loadConfig();
    expect(config.use.trace).toBe('retain-on-failure-and-retries');
    expect(config.use.video).toBe('retain-on-failure-and-retries');
  });

  it('preserves explicit capture overrides', () => {
    process.env.PLAYWRIGHT_TRACE = 'off';
    process.env.PLAYWRIGHT_VIDEO = 'on';
    const config = loadConfig();
    expect(config.use.trace).toBe('off');
    expect(config.use.video).toBe('on');
  });

  it('groups the HTML view without replacing the JSON reporter', () => {
    const config = loadConfig();
    expect(
      config.reporter.find(([name]: [string]) => name === 'html')[1].mergeFiles,
    ).toBe(true);
    expect(config.reporter.some(([name]: [string]) => name === 'json')).toBe(
      true,
    );
  });

  it('still routes each browser tag to its existing project', () => {
    const config = loadConfig();
    expect(config.selected).toEqual([
      ['chromium'],
      ['firefox'],
      ['safari'],
      ['mobile-safari'],
    ]);
    expect(config.allDefault).toBe(true);
  });
});

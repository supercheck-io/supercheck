import * as path from 'node:path';

describe('Playwright execution configuration', () => {
  const configPath = path.resolve(__dirname, '../playwright.config.js');
  const originalTrace = process.env.PLAYWRIGHT_TRACE;
  const originalVideo = process.env.PLAYWRIGHT_VIDEO;

  afterEach(() => {
    if (originalTrace === undefined) delete process.env.PLAYWRIGHT_TRACE;
    else process.env.PLAYWRIGHT_TRACE = originalTrace;
    if (originalVideo === undefined) delete process.env.PLAYWRIGHT_VIDEO;
    else process.env.PLAYWRIGHT_VIDEO = originalVideo;
    jest.resetModules();
  });

  function loadConfig() {
    jest.resetModules();
    return jest.requireActual(configPath);
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
    expect(config.reporter.find(([name]: [string]) => name === 'html')[1].mergeFiles).toBe(true);
    expect(config.reporter.some(([name]: [string]) => name === 'json')).toBe(true);
  });

  it('still routes each browser tag to its existing project', () => {
    const projects = loadConfig().projects;
    const selected = (title: string) => projects.filter((project: { grep?: RegExp; grepInvert?: RegExp }) =>
      (!project.grep || project.grep.test(title)) && (!project.grepInvert || !project.grepInvert.test(title)),
    ).map((project: { name: string }) => project.name);
    expect(selected('plain test')).toEqual(['chromium']);
    expect(selected('test @firefox')).toEqual(['firefox']);
    expect(selected('test @webkit')).toEqual(['safari']);
    expect(selected('test @mobile')).toEqual(['mobile-safari']);
    expect(projects.every((project: { default?: boolean }) => project.default !== false)).toBe(true);
  });
});

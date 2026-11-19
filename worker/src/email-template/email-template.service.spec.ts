import { EmailTemplateService, formatDuration } from './email-template.service';
import * as monitorAlert from '../emails/monitor-alert';
import { formatEmailTime } from '../emails/base-layout';

describe('EmailTemplateService (local render)', () => {
  const service = new EmailTemplateService();

  it('renders a monitor alert with an incidents button on failure', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Monitor Down - API',
      message: 'API is down',
      fields: [{ title: 'Monitor', value: 'API' }],
      footer: 'Supercheck Monitoring System',
      type: 'failure',
      appUrl: 'https://app.example.com/',
    });
    expect(r.subject).toBe('[Supercheck] Monitor Down: API');
    expect(r.html).toContain('View incidents');
    expect(r.html).toContain('https://app.example.com/incidents');
    expect(r.text).toContain('API is down');
  });

  it('Job Completed email: inbox preview is a short summary and the text part keeps one detail per line', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Job Completed - Rhona Mclean',
      message: 'Job "Rhona Mclean" passed\n in 12s.',
      fields: [
        { title: 'Project', value: 'Default Project' },
        { title: 'Job', value: 'Rhona Mclean' },
        { title: 'Type', value: 'Playwright' },
        { title: 'Status', value: 'Passed' },
      ],
      footer: 'Supercheck Job Monitoring',
      type: 'success',
    });
    const preheader = /data-skip-in-text="true">([^<]*)</.exec(r.html)?.[1];
    expect(preheader).toBe('Job &quot;Rhona Mclean&quot; passed in 12s.');
    expect(r.text).not.toMatch(/ProjectDefault|Default ProjectJob/);
    expect(r.text).toMatch(/^Project +Default Project$/m);
    expect(r.text).toMatch(/^Job +Rhona Mclean$/m);
    expect(r.text).toMatch(/^Status +Passed$/m);
  });

  it('cuts a long preheader and falls back to the title when there is no message', () => {
    expect(monitorAlert.alertEmailPreview('', 'Job Completed: X')).toBe(
      'Job Completed: X',
    );
    const long = monitorAlert.alertEmailPreview('word '.repeat(60), 't');
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('formats times exactly like the app (pinned literal also asserted in app templates.spec)', () => {
    expect(formatEmailTime(new Date('2026-11-18T06:02:36Z'))).toBe(
      'Wed, 18 Nov 2026 06:02:36 UTC',
    );
  });

  it('takes the logo from appUrl even when no env var is set', async () => {
    const prev = { a: process.env.NEXT_PUBLIC_APP_URL, b: process.env.APP_URL };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
    try {
      const r = await service.renderMonitorAlertEmail({
        title: 'Monitor Down - API',
        message: 'm',
        fields: [],
        footer: '',
        type: 'failure',
        appUrl: 'https://app.example.com/',
      });
      expect(r.html).toContain('https://app.example.com/supercheck-logo.png');
    } finally {
      if (prev.a === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev.a;
      if (prev.b === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev.b;
    }
  });

  it('renders recovery as Resolved without an incidents button', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Recovered',
      message: 'ok',
      fields: [],
      footer: 'x',
      type: 'recovery',
      appUrl: 'https://app.example.com',
    });
    expect(r.html).toContain('Resolved');
    expect(r.html).not.toContain('View incidents');
  });

  it('escapes an apostrophe once and ships a plain-text part, logo and settings link', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Job Failed - Owner\'s "nightly" & co',
      message: 'Job failed',
      fields: [{ title: 'Time', value: 'Wed, 18 Nov 2026 06:02:36 UTC' }],
      footer: '',
      type: 'failure',
      appUrl: 'https://app.example.com',
    });
    expect(r.subject).toBe('[Supercheck] Job Failed: Owner\'s "nightly" & co');
    expect(r.html).toContain('Owner&#x27;s');
    expect(r.html).not.toMatch(/&amp;(#|quot;|amp;)/);
    expect(r.text).toContain('Owner\'s "nightly" & co');
    expect(r.text).not.toMatch(/&#|&amp;|<[a-z]/);
    expect(r.html).toContain('https://app.example.com/notifications');
    expect(r.html).toContain('lang="en"');
  });

  it('omits the incidents button when no app url is known', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Job Failed - Nightly',
      message: 'Job "Nightly" has failed.',
      fields: [{ title: 'Error', value: 'boom' }],
      footer: '',
      type: 'failure',
    });
    expect(r.subject).toBe('[Supercheck] Job Failed: Nightly');
    expect(r.html).toContain('boom');
    expect(r.html).not.toContain('View incidents');
  });

  it('keeps multi-line error text (pre-wrap) in the details table', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Job Failed - J',
      message: 'm',
      fields: [{ title: 'Error', value: 'line1\nline2' }],
      footer: '',
      type: 'failure',
    });
    expect(r.html).toContain('white-space:pre-wrap');
  });

  it('uses a blue info badge under the neutral header, not the warning amber', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'FYI - X',
      message: 'm',
      fields: [],
      footer: '',
      type: 'info',
    });
    expect(r.html).toContain('background:#1f2937');
    expect(r.html).toContain('background-color:#dbeafe');
    expect(r.html).not.toContain('background-color:#fef3c7');
  });

  it('falls back to escaped basic HTML when React rendering throws', async () => {
    jest.spyOn(monitorAlert, 'MonitorAlertEmail').mockImplementation(() => {
      throw new Error('render exploded');
    });
    const r = await service.renderMonitorAlertEmail({
      title: 'T <b>',
      message: 'm',
      fields: [{ title: 'k', value: '<script>' }],
      footer: 'f',
      type: 'failure',
    });
    expect(r.subject).toBe('[Supercheck] T <b>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.text).toContain('k: <script>');
    jest.restoreAllMocks();
  });
});

describe('EmailTemplateService job and recovery emails', () => {
  const service = new EmailTemplateService();

  it('labels a job pass "Passed", without the Resolved chip', async () => {
    const email = await service.renderMonitorAlertEmail({
      title: 'Job Completed - Nightly',
      message: 'ok',
      fields: [{ title: 'Duration', value: '1m 05s' }],
      footer: '',
      type: 'success',
    });
    expect(email.html).toContain('Passed');
    expect(email.html).not.toContain('Recovered');
    expect(email.html).not.toContain('Resolved');
  });

  it('labels a monitor recovery "Recovered" with the Resolved chip', async () => {
    const email = await service.renderMonitorAlertEmail({
      title: 'Monitor Recovered - API',
      message: 'Monitor "API" is back up.',
      fields: [{ title: 'Status', value: 'UP' }],
      footer: '',
      type: 'recovery',
    });
    expect(email.html).toContain('Recovered');
    expect(email.html).toContain('Resolved');
  });

  it('keeps detail labels and values apart in the plain-text part', async () => {
    const email = await service.renderMonitorAlertEmail({
      title: 'Job Completed - Nightly',
      message: 'ok',
      fields: [
        { title: 'Job', value: 'Nightly' },
        { title: 'Duration', value: '1m 05s' },
      ],
      footer: '',
      type: 'success',
    });
    expect(email.text).not.toMatch(/JobNightly/);
    expect(email.text).toMatch(/Job\s+Nightly/);
    expect(email.text).toMatch(/Duration\s+1m 05s/);
  });

  it.each([
    [0, '0s'],
    [1, '1s'],
    [59, '59s'],
    [65, '1m 05s'],
    [3720, '1h 02m'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  describe('logo', () => {
    const saved = {
      a: process.env.NEXT_PUBLIC_APP_URL,
      b: process.env.APP_URL,
    };
    const params = {
      title: 'Monitor Down - API',
      message: 'm',
      fields: [],
      footer: '',
      type: 'failure' as const,
    };
    afterEach(() => {
      for (const [k, v] of [
        ['NEXT_PUBLIC_APP_URL', saved.a],
        ['APP_URL', saved.b],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("loads the logo from the instance's own app URL", async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://sc.acme.test/';
      const r = await service.renderMonitorAlertEmail(params);
      expect(r.html).toContain('https://sc.acme.test/supercheck-logo.png');
    });

    it('omits the image without an app URL and never contacts supercheck.io', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.APP_URL;
      const r = await service.renderMonitorAlertEmail(params);
      expect(r.html).toContain('You received this alert'); // shared layout rendered, not the fallback
      expect(r.html).not.toContain('<img');
      expect(r.html).not.toContain('supercheck-logo.png');
    });
  });
});

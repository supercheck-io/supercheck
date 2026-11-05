import { EmailTemplateService, formatDuration } from './email-template.service';
import * as monitorAlert from '../emails/monitor-alert';

describe('EmailTemplateService (local render)', () => {
  const service = new EmailTemplateService();

  it('renders a monitor alert with an incidents button on failure', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Monitor Down - API',
      message: 'API is down',
      fields: [{ title: 'Monitor', value: 'API' }],
      footer: 'Supercheck Monitoring System',
      type: 'failure',
      color: '#dc2626',
      appUrl: 'https://app.example.com/',
    });
    expect(r.subject).toBe('Monitor Down - API');
    expect(r.html).toContain('View incidents');
    expect(r.html).toContain('https://app.example.com/incidents');
    expect(r.text).toContain('API is down');
  });

  it('renders recovery as Resolved without an incidents button', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'Recovered',
      message: 'ok',
      fields: [],
      footer: 'x',
      type: 'recovery',
      color: '#10b981',
      appUrl: 'https://app.example.com',
    });
    expect(r.html).toContain('Resolved');
    expect(r.html).not.toContain('View incidents');
  });

  it('omits the incidents button when no app url is known', async () => {
    const r = await service.renderJobFailureEmail({
      jobName: 'Nightly',
      duration: 3,
      errorMessage: 'boom',
      runId: 'r1',
      dashboardUrl: 'https://app.example.com/run/r1',
    });
    expect(r.subject).toBe('Job Failed - Nightly');
    expect(r.html).toContain('boom');
    expect(r.html).not.toContain('View incidents');
  });

  it('renders job success and timeout', async () => {
    const ok = await service.renderJobSuccessEmail({
      jobName: 'J',
      duration: 1,
    });
    expect(ok.subject).toBe('Job Completed - J');
    const to = await service.renderJobTimeoutEmail({
      jobName: 'J',
      duration: 5,
      appUrl: 'https://a.io',
    });
    expect(to.subject).toBe('Job Timeout - J');
    expect(to.html).toContain('https://a.io/incidents');
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
      color: '#dc2626',
    });
    expect(r.subject).toBe('T <b>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.text).toContain('k: <script>');
    jest.restoreAllMocks();
  });
});

describe('EmailTemplateService job and recovery emails', () => {
  const service = new EmailTemplateService();
  const base = {
    jobName: 'Nightly',
    duration: 65,
    runId: 'run-1',
    dashboardUrl: 'https://app.example.io/notification-run/run-1',
  };

  it('labels a job pass "Passed", without the Resolved chip', async () => {
    const email = await service.renderJobSuccessEmail(base);
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
      color: '#22c55e',
    });
    expect(email.html).toContain('Recovered');
    expect(email.html).toContain('Resolved');
  });

  it('keeps detail labels and values apart in the plain-text part', async () => {
    const email = await service.renderJobSuccessEmail(base);
    expect(email.text).not.toMatch(/Job NameNightly/);
    expect(email.text).toMatch(/Job Name\s+Nightly/);
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
});

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
      appUrl: 'https://app.example.com/',
    });
    expect(r.subject).toBe('[Supercheck] Monitor Down: API');
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
      appUrl: 'https://app.example.com',
    });
    expect(r.html).toContain('Resolved');
    expect(r.html).not.toContain('View incidents');
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

  it('uses the info tone (blue), not the warning amber', async () => {
    const r = await service.renderMonitorAlertEmail({
      title: 'FYI - X',
      message: 'm',
      fields: [],
      footer: '',
      type: 'info',
    });
    expect(r.html).toContain('#1d4ed8');
    expect(r.html).not.toContain('#b45309');
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
});

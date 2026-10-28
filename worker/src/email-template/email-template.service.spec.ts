import { EmailTemplateService } from './email-template.service';
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
      type: 'success',
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

import {
  normalizeWebhookMethod,
  parseWebhookJsonTemplate,
  renderWebhookJsonTemplate,
} from './webhook-template';

describe('webhook-template', () => {
  it('renders valid JSON with escaped interpolated values', () => {
    const body = renderWebhookJsonTemplate(
      JSON.stringify({
        payload: {
          summary: '{{title}}',
          details: '{{errorMessage}}',
        },
      }),
      {
        title: 'Monitor "API"\nDown',
        errorMessage: 'Socket \\ reset\nline2',
      },
    );

    const parsed = JSON.parse(body);

    expect(parsed.payload.summary).toBe('Monitor "API"\nDown');
    expect(parsed.payload.details).toBe('Socket \\ reset\nline2');
  });

  it('preserves unknown placeholders as-is', () => {
    const body = renderWebhookJsonTemplate(
      '{"unknown":"{{missingVar}}"}',
      {},
    );

    expect(JSON.parse(body).unknown).toBe('{{missingVar}}');
  });

  it('normalizes supported methods and rejects unsupported ones', () => {
    expect(normalizeWebhookMethod(undefined)).toBe('POST');
    expect(normalizeWebhookMethod(' get ')).toBe('GET');
    expect(() => normalizeWebhookMethod('PATCH')).toThrow(
      'Webhook method must be one of: GET, POST, PUT',
    );
  });

  it('rejects malformed JSON templates', () => {
    expect(() => parseWebhookJsonTemplate('{"summary": {{title}}}')).toThrow(
      'Body template must be valid JSON',
    );
  });
});

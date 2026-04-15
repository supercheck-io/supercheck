const WEBHOOK_TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;

export const WEBHOOK_ALLOWED_METHODS = ['GET', 'POST', 'PUT'] as const;
export type WebhookMethod = (typeof WEBHOOK_ALLOWED_METHODS)[number];

export function normalizeWebhookMethod(method: unknown): WebhookMethod {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return 'POST';
  }

  const normalizedMethod = method.trim().toUpperCase();
  if (
    !WEBHOOK_ALLOWED_METHODS.includes(normalizedMethod as WebhookMethod)
  ) {
    throw new Error(
      `Webhook method must be one of: ${WEBHOOK_ALLOWED_METHODS.join(', ')}`,
    );
  }

  return normalizedMethod as WebhookMethod;
}

export function parseWebhookJsonTemplate(template: string): unknown {
  if (!template.trim()) {
    throw new Error('Body template must not be empty');
  }

  try {
    return JSON.parse(template);
  } catch {
    throw new Error('Body template must be valid JSON');
  }
}

export function renderWebhookJsonTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return JSON.stringify(
    renderWebhookTemplateValue(parseWebhookJsonTemplate(template), variables),
  );
}

function renderWebhookTemplateValue(
  value: unknown,
  variables: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return renderWebhookTemplateString(value, variables);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderWebhookTemplateValue(item, variables));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        renderWebhookTemplateString(key, variables),
        renderWebhookTemplateValue(child, variables),
      ]),
    );
  }

  return value;
}

function renderWebhookTemplateString(
  value: string,
  variables: Record<string, string>,
): string {
  return value.replace(
    WEBHOOK_TEMPLATE_PATTERN,
    (match, key: string) => variables[key] ?? match,
  );
}

import {
  clearProviderTokenCache,
  type ProviderContext,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type ProviderSearchParams,
} from "./provider-core";

export type MockReply = Partial<ProviderHttpResponse> & { json?: unknown };

export function mockHttp(replies: MockReply[] | ((req: ProviderHttpRequest) => MockReply)) {
  const calls: ProviderHttpRequest[] = [];
  let index = 0;
  const http = jest.fn(async (req: ProviderHttpRequest): Promise<ProviderHttpResponse> => {
    calls.push(req);
    const reply = typeof replies === "function" ? replies(req) : replies[Math.min(index++, replies.length - 1)];
    return {
      status: reply.status ?? 200,
      text: reply.text ?? JSON.stringify(reply.json ?? {}),
      truncated: reply.truncated ?? false,
    };
  });
  return { http, calls };
}

export function makeContext(
  http: ProviderContext["http"],
  credential: ProviderContext["credential"] = {},
  endpointUrl: string | null = null,
): ProviderContext {
  clearProviderTokenCache();
  return { http, credential, endpointUrl, now: () => Date.parse("2026-10-27T12:00:00Z") };
}

export const WINDOW = {
  start: new Date("2026-10-27T11:00:00Z"),
  end: new Date("2026-10-27T12:00:00Z"),
};

export function params(query: string, overrides: Partial<ProviderSearchParams> = {}): ProviderSearchParams {
  return { query, timeWindow: WINDOW, maxRows: 10, maxBytes: 256_000, maxSeconds: 10, ...overrides };
}

export function hostOf(url: string) {
  return new URL(url).hostname;
}

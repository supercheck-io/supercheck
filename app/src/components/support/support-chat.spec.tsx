import { act, render, waitFor } from "@testing-library/react";
import { ChatwootWidget, resetChatwootSession } from "./chatwoot-widget";
import { SupportChat } from "./support-chat";

let mockUserId: string | null = "u1";

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({
    data: mockUserId
      ? { user: { id: mockUserId, email: `${mockUserId}@example.com` }, session: {} }
      : null,
  }),
}));
jest.mock("@/hooks/use-impersonation-status", () => ({
  useImpersonationStatus: () => ({ isImpersonating: false, isLoading: false }),
}));
jest.mock("./chatwoot-widget", () => ({
  ChatwootWidget: jest.fn(() => null),
  resetChatwootSession: jest.fn(),
}));

const originalFetch = global.fetch;
const fetchMock = jest.fn();
const widgetMock = jest.mocked(ChatwootWidget);
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe("SupportChat identity requests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    mockUserId = "u1";
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([null, "u2"])("ignores the old user's late token after changing session to %p", async (nextUserId) => {
    let resolveOldToken!: (value: Response) => void;
    const oldToken = new Promise<Response>((resolve) => { resolveOldToken = resolve; });
    fetchMock
      .mockResolvedValueOnce(response({ enabled: true, baseUrl: "https://app.chatwoot.com", websiteToken: "test" }))
      .mockReturnValueOnce(oldToken)
      .mockResolvedValueOnce(response({ token: "new-user-hash" }));

    const { rerender } = render(<SupportChat />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(widgetMock).not.toHaveBeenCalled();

    mockUserId = nextUserId;
    rerender(<SupportChat />);
    expect(resetChatwootSession).toHaveBeenCalledTimes(1);
    if (nextUserId) {
      await waitFor(() => expect(widgetMock).toHaveBeenCalled());
    }

    const callsBeforeOldResponse = widgetMock.mock.calls.length;
    await act(async () => {
      resolveOldToken(response({ token: "old-user-hash" }));
      await oldToken;
    });
    expect(widgetMock).toHaveBeenCalledTimes(callsBeforeOldResponse);
    if (nextUserId) {
      const props = widgetMock.mock.calls.at(-1)?.[0];
      expect(props?.user).toMatchObject({ id: "u2", identityValidationToken: "new-user-hash" });
    } else {
      expect(widgetMock).not.toHaveBeenCalled();
    }
  });
});

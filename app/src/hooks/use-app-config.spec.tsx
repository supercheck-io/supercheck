import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppConfig } from "./use-app-config";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useAppConfig", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses localhost as the safe status page fallback before config loads", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    jest.spyOn(global, "fetch").mockImplementation(
      () => new Promise(() => undefined) as Promise<Response>
    );

    const { result } = renderHook(() => useAppConfig(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.statusPageDomain).toBe("localhost");
    expect(result.current.hideStatusPageBranding).toBe(false);
  });

  it("uses the server-provided status page domain once config resolves", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        hosting: { selfHosted: false, cloudHosted: true },
        authProviders: {
          github: { enabled: false },
          google: { enabled: false },
        },
        registration: {
          signupEnabled: true,
          allowedEmailDomains: [],
        },
        demoMode: false,
        showCommunityLinks: false,
        limits: {
          maxJobNotificationChannels: 10,
          maxMonitorNotificationChannels: 10,
        },
        statusPage: {
          domain: "supercheck.io",
          hideBranding: true,
        },
      }),
    } as Response);

    const { result } = renderHook(() => useAppConfig(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.statusPageDomain).toBe("supercheck.io");
    });

    expect(result.current.hideStatusPageBranding).toBe(true);
  });
});
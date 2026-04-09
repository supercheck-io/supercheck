import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubscriptionGuard } from "./subscription-guard";
import { useAppConfig } from "@/hooks/use-app-config";

const pushMock = jest.fn();
let pathname = "/dashboard";

jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => pathname,
}));

const mockUseAppConfig = useAppConfig as jest.MockedFunction<typeof useAppConfig>;

function makeAppConfig(overrides: Partial<ReturnType<typeof useAppConfig>> = {}): ReturnType<typeof useAppConfig> {
  return {
    config: {
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
        recentMonitorResultsLimit: undefined,
      },
      statusPage: {
        domain: "supercheck.io",
        customDomainTarget: "supercheck.io",
        hideBranding: false,
      },
    },
    isLoading: false,
    isFetched: true,
    error: null,
    isSelfHosted: false,
    isCloudHosted: true,
    isDemoMode: false,
    showCommunityLinks: false,
    isGithubEnabled: false,
    isGoogleEnabled: false,
    isSignupEnabled: true,
    allowedEmailDomains: [],
    maxJobNotificationChannels: 10,
    maxMonitorNotificationChannels: 10,
    recentMonitorResultsLimit: undefined,
    statusPageDomain: "supercheck.io",
    statusPageCnameTarget: "supercheck.io",
    hideStatusPageBranding: false,
    ...overrides,
  };
}

function renderGuard(props: Parameters<typeof SubscriptionGuard>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionGuard {...props}>
        <div>Protected content</div>
      </SubscriptionGuard>
    </QueryClientProvider>
  );
}

describe("SubscriptionGuard", () => {
  beforeEach(() => {
    pathname = "/dashboard";
    pushMock.mockReset();
    global.fetch = jest.fn() as unknown as typeof fetch;
    mockUseAppConfig.mockReturnValue(makeAppConfig());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("revalidates seeded cloud subscription state on mount", async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ isActive: false, plan: null }),
    });

    renderGuard({
      children: <div>Protected content</div>,
      initialSubscriptionStatus: { isActive: true, plan: "plus" },
      initialIsSelfHosted: false,
    });

    expect(screen.getByText("Protected content")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/subscription/status");
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/subscribe?required=true");
    });
  });

  it("skips the subscription query entirely in self-hosted mode", async () => {
    const fetchMock = global.fetch as unknown as jest.Mock;

    renderGuard({
      children: <div>Protected content</div>,
      initialSubscriptionStatus: { isActive: true, plan: "unlimited" },
      initialIsSelfHosted: true,
    });

    await waitFor(() => {
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

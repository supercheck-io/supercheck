import { renderHook } from "@testing-library/react";
import { useStatusPages } from "./use-status-pages";
import { useAppConfig } from "./use-app-config";

jest.mock("./lib/create-data-hook", () => ({
  __mockUseList: jest.fn(),
  createDataHook: jest.fn(() => ({
    useList: jest.requireMock("./lib/create-data-hook").__mockUseList,
    useSingle: jest.fn(),
    useMutations: jest.fn(),
  })),
}));

jest.mock("./use-app-config", () => ({
  useAppConfig: jest.fn(),
}));

const { __mockUseList: mockUseList } = jest.requireMock("./lib/create-data-hook") as {
  __mockUseList: jest.Mock;
};
const mockUseAppConfig = useAppConfig as jest.MockedFunction<typeof useAppConfig>;

function makeListResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      data: [],
      pagination: {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      },
    },
    items: [],
    total: 0,
    pagination: {
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    },
    isLoading: false,
    isPending: false,
    isRestoring: false,
    isRefetching: false,
    isFetching: false,
    hasData: true,
    error: null,
    refetch: jest.fn(),
    invalidate: jest.fn(),
    ...overrides,
  };
}

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
        domain: "supercheck.example.com",
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
    statusPageDomain: "supercheck.example.com",
    hideStatusPageBranding: false,
    ...overrides,
  };
}

describe("useStatusPages", () => {
  beforeEach(() => {
    mockUseList.mockReturnValue(makeListResult());
    mockUseAppConfig.mockReturnValue(makeAppConfig());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("prefers the list response status page domain when present", () => {
    mockUseList.mockReturnValue(
      makeListResult({
        data: {
          data: [],
          statusPageDomain: "status.api.example.com",
          pagination: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 0,
          },
        },
      })
    );

    const { result } = renderHook(() => useStatusPages());

    expect(result.current.statusPageDomain).toBe("status.api.example.com");
  });

  it("falls back to app config when persisted list data lacks statusPageDomain", () => {
    const { result } = renderHook(() => useStatusPages());

    expect(result.current.statusPageDomain).toBe("supercheck.example.com");
  });

  it("keeps the domain undefined until app config has been fetched", () => {
    mockUseAppConfig.mockReturnValue(
      makeAppConfig({
        isFetched: false,
      })
    );

    const { result } = renderHook(() => useStatusPages());

    expect(result.current.statusPageDomain).toBeUndefined();
  });
});

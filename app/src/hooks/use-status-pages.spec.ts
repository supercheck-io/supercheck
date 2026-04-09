import { renderHook } from "@testing-library/react";
import { useStatusPageDetail, useStatusPages } from "./use-status-pages";
import { useAppConfig } from "./use-app-config";
import { useProjectContext } from "./use-project-context";
import {
  useIsRestoring,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
  useIsRestoring: jest.fn(),
}));

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

jest.mock("./use-project-context", () => ({
  useProjectContext: jest.fn(),
}));

const { __mockUseList: mockUseList } = jest.requireMock("./lib/create-data-hook") as {
  __mockUseList: jest.Mock;
};
const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;
const mockUseQueryClient = useQueryClient as jest.MockedFunction<
  typeof useQueryClient
>;
const mockUseIsRestoring = useIsRestoring as jest.MockedFunction<
  typeof useIsRestoring
>;
const mockUseAppConfig = useAppConfig as jest.MockedFunction<typeof useAppConfig>;
const mockUseProjectContext = useProjectContext as jest.MockedFunction<
  typeof useProjectContext
>;

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
        customDomainTarget: "cname.supercheck.example.com",
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
    statusPageCnameTarget: "cname.supercheck.example.com",
    hideStatusPageBranding: false,
    ...overrides,
  };
}

describe("useStatusPages", () => {
  beforeEach(() => {
    mockUseList.mockReturnValue(makeListResult());
    mockUseAppConfig.mockReturnValue(makeAppConfig());
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: jest.fn(),
    } as unknown as ReturnType<typeof useQueryClient>);
    mockUseIsRestoring.mockReturnValue(false);
    mockUseProjectContext.mockReturnValue({
      currentProject: { id: "project-1" },
    } as ReturnType<typeof useProjectContext>);
    mockUseQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useQuery>);
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
          statusPageCnameTarget: "cname.status.api.example.com",
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
    expect(result.current.statusPageCnameTarget).toBe(
      "cname.status.api.example.com"
    );
  });

  it("falls back to app config when persisted list data lacks statusPageDomain", () => {
    const { result } = renderHook(() => useStatusPages());

    expect(result.current.statusPageDomain).toBe("supercheck.example.com");
    expect(result.current.statusPageCnameTarget).toBe(
      "cname.supercheck.example.com"
    );
  });

  it("keeps the domain undefined until app config has been fetched", () => {
    mockUseAppConfig.mockReturnValue(
      makeAppConfig({
        isFetched: false,
      })
    );

    const { result } = renderHook(() => useStatusPages());

    expect(result.current.statusPageDomain).toBeUndefined();
    expect(result.current.statusPageCnameTarget).toBeUndefined();
  });

  it("falls back to app config when persisted detail data lacks statusPageCnameTarget", () => {
    mockUseQuery.mockReturnValue({
      data: {
        statusPage: {
          id: "page-1",
          name: "Status page",
          subdomain: "status",
          status: "draft",
          pageDescription: null,
          headline: null,
          supportUrl: null,
          timezone: null,
          allowPageSubscribers: true,
          customDomain: null,
          customDomainVerified: false,
          language: "en",
          faviconLogo: null,
          transactionalLogo: null,
          heroCover: null,
          createdAt: null,
          updatedAt: null,
          projectId: "project-1",
          organizationId: "org-1",
        },
        statusPageDomain: "status.api.example.com",
        components: [],
        monitors: [],
        canUpdate: true,
      },
      isPending: false,
      isFetching: false,
      error: null,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    const { result } = renderHook(() => useStatusPageDetail("page-1"));

    expect(result.current.statusPageDomain).toBe("status.api.example.com");
    expect(result.current.statusPageCnameTarget).toBe(
      "cname.supercheck.example.com"
    );
  });
});

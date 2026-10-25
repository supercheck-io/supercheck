import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/super-admin",
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/breadcrumb-context", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: jest.fn() }) }));
jest.mock("@/hooks/use-super-admin", () => ({
  useSuperAdminStats: () => ({
    isLoading: false,
    stats: {
      users: { totalUsers: 1111, activeUsers: 2222, bannedUsers: 3, newUsersThisMonth: 4 },
      organizations: { totalOrganizations: 5555, totalProjects: 6666, totalJobs: 7777, totalTests: 8888, totalMonitors: 9999, totalRuns: 12345 },
    },
  }),
  useSuperAdminUsers: () => ({ users: [], isLoading: false }),
  useSuperAdminOrganizations: () => ({ organizations: [], isLoading: false }),
  useSuperAdminDataInvalidation: () => ({ invalidateStats: jest.fn(), invalidateUsers: jest.fn() }),
}));
jest.mock("@/components/admin/user-table", () => ({ UserTable: () => null }));
jest.mock("@/components/admin/org-table", () => ({ OrgTable: () => null }));
jest.mock("@/components/admin/locations-table", () => ({ LocationsTable: () => null }));

import SuperAdminPage from "./page";

describe("Super Admin overview", () => {
  it("shows each platform figure exactly once", () => {
    render(<SuperAdminPage />);
    for (const value of ["1,111", "2,222", "5,555", "6,666", "7,777", "8,888", "9,999", "12,345"]) {
      expect(screen.getAllByText(value)).toHaveLength(1);
    }
    expect(screen.queryByText("User Statistics")).toBeNull();
    expect(screen.queryByText("Platform Activity")).toBeNull();
    expect(screen.queryByText("Test Executions")).toBeNull();
  });

  it("keeps banned users and new users visible as subtitles", () => {
    render(<SuperAdminPage />);
    expect(screen.getByText("4 new this month")).toBeInTheDocument();
    expect(screen.getByText("3 banned users")).toBeInTheDocument();
  });
});

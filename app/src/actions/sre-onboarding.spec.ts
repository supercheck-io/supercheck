/** @jest-environment node */

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(() => true),
}));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));

import { requireProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { getSreOnboardingStatus } from "./sre-onboarding";

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireProjectContext).mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1" },
  } as never);
});

it.each([0, 2])(
  "completes connector setup with %i optional saved queries",
  async (queryCount) => {
    const counts = [1, 1, queryCount, 0];
    jest.mocked(db.select).mockImplementation(
      () =>
        ({
          from: jest
            .fn()
            .mockReturnValue({
              where: jest.fn().mockResolvedValue([{ count: counts.shift() }]),
            }),
        }) as never,
    );
    const result = await getSreOnboardingStatus();
    expect(result).toMatchObject({
      success: true,
      status: {
        diagnosticRecipes: queryCount,
        completedRequiredSteps: 2,
        requiredSteps: 2,
        complete: true,
      },
    });
  },
);

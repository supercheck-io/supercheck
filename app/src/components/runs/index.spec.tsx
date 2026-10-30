import { render, screen } from "@testing-library/react";
import { Runs } from "./index";

let mockState: Record<string, unknown>;
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { userRole: "project_admin" } }) }));
jest.mock("@/hooks/use-runs", () => ({ useRuns: () => mockState }));
jest.mock("./data-table", () => ({ DataTable: () => <div>table</div> }));
jest.mock("./columns", () => ({ createColumns: () => [] }));

const base = { runs: [], isLoading: false, isRestoring: false, error: null, invalidate: jest.fn() };

describe("Runs list", () => {
  it("shows an error state with retry when the load fails and nothing is cached", () => {
    mockState = { ...base, error: new Error("boom") };
    render(<Runs />);
    expect(screen.getByText("Failed to fetch runs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("notes the cap when the list is full", () => {
    mockState = { ...base, runs: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), status: "passed" })) };
    render(<Runs />);
    expect(screen.getByRole("status")).toHaveTextContent("1000");
  });
});

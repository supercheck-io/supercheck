import { render, screen } from "@testing-library/react";
import { useExecutions } from "@/hooks/use-executions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ParallelThreads } from "./parallel-threads";

jest.mock("@/hooks/use-media-query", () => ({ useMediaQuery: jest.fn() }));
jest.mock("@/hooks/use-executions", () => ({ useExecutions: jest.fn() }));
jest.mock("./executions/executions-dialog", () => ({ ExecutionsDialog: () => null }));

describe("ParallelThreads", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not start the live executions feed below the xl breakpoint", () => {
    jest.mocked(useMediaQuery).mockReturnValue(false);
    render(<ParallelThreads />);
    expect(useMediaQuery).toHaveBeenCalledWith("(min-width: 1280px)");
    expect(useExecutions).not.toHaveBeenCalled();
  });

  it("shows the live counts at xl and up", () => {
    jest.mocked(useMediaQuery).mockReturnValue(true);
    jest.mocked(useExecutions).mockReturnValue({
      runningCount: 1, queuedCount: 2, runningCapacity: 4, queuedCapacity: 10, loading: false,
    } as ReturnType<typeof useExecutions>);
    render(<ParallelThreads />);
    expect(useExecutions).toHaveBeenCalled();
    expect(screen.getByText("PARALLEL")).toBeInTheDocument();
  });
});

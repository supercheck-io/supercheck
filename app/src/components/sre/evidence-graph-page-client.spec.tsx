import { render, screen } from "@testing-library/react";
import { useSreEvidenceGraph } from "@/hooks/use-sre";
import { SreEvidenceGraphPageClient } from "./evidence-graph-page-client";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("incident=invalid-id"),
}));
jest.mock("@/hooks/use-sre", () => ({ useSreEvidenceGraph: jest.fn() }));
jest.mock("@/components/sre/evidence-graph", () => ({
  SreEvidenceGraph: ({ loadError }: { loadError: string }) => <p role="alert">{loadError}</p>,
}));

it("shows the server validation error for a malformed incident link instead of loading the unscoped map", () => {
  (useSreEvidenceGraph as jest.Mock).mockReturnValue({
    data: { success: false, error: "Invalid incident ID", graph: { nodes: [], edges: [] } },
  });
  render(<SreEvidenceGraphPageClient />);
  expect(useSreEvidenceGraph).toHaveBeenCalledWith("invalid-id");
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid incident ID");
});

import { fireEvent, render, screen } from "@testing-library/react";

import { classifyLoadError, PageErrorState } from "./page-error-state";

describe("classifyLoadError", () => {
  it.each([
    ["Incident not found or access denied", "not_found"],
    ["Invalid service ID", "not_found"],
    ["Insufficient permissions to view SRE incidents", "forbidden"],
    ["Failed to fetch SRE incident", "failed"],
    [undefined, "failed"],
  ])("sorts %p as %s", (message, kind) => {
    expect(classifyLoadError(message)).toBe(kind);
  });
});

describe("PageErrorState", () => {
  const base = { noun: "incident", backHref: "/incidents", backLabel: "Back to incidents" };

  it("offers Try again and the raw message when loading failed", () => {
    const retry = jest.fn();
    render(<PageErrorState {...base} message="Failed to fetch SRE incident" onRetry={retry} />);
    expect(screen.getByRole("heading", { name: "Could not load this incident" })).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch SRE incident")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Back to incidents" })).toHaveAttribute("href", "/incidents");
  });

  it("disables Try again while retrying", () => {
    render(<PageErrorState {...base} message="boom" onRetry={jest.fn()} retrying />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });

  it("says not found without a retry button", () => {
    render(<PageErrorState {...base} message="Incident not found or access denied" onRetry={jest.fn()} />);
    expect(screen.getByRole("heading", { name: "This incident could not be found" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("explains missing permission", () => {
    render(<PageErrorState {...base} noun="service" message="Insufficient permissions to view services" />);
    expect(screen.getByRole("heading", { name: "You do not have access to this service" })).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";

import { IncidentPersonAvatar } from "./incident-person-avatar";

describe("IncidentPersonAvatar", () => {
  it("shows initials for a person", () => {
    render(<IncidentPersonAvatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("shows a person icon when nobody is assigned", () => {
    const { container } = render(<IncidentPersonAvatar name={null} />);
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});

import { render, screen } from "@testing-library/react";
import { Bell } from "lucide-react";

import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as the page heading with description and actions", () => {
    render(
      <PageHeader
        title="Alerts"
        description="Review alerts"
        actions={<button type="button">Add</button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("Review alerts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("omits the description and actions when not provided", () => {
    const { container } = render(<PageHeader title="Services" />);

    expect(screen.getByRole("heading", { name: "Services" })).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a decorative area chip before the title when an icon is given", () => {
    const { container } = render(<PageHeader title="Notifications" icon={Bell} tone="communicate" />);

    const chip = container.querySelector('[data-tone="communicate"]');
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
  });

  it("defaults the chip to the neutral slate tone", () => {
    const { container } = render(<PageHeader title="Organization" icon={Bell} />);

    expect(container.querySelector('[data-tone="slate"]')).not.toBeNull();
  });

  it("renders no chip without an icon", () => {
    const { container } = render(<PageHeader title="Services" />);

    expect(container.querySelector("[data-tone]")).toBeNull();
  });
});

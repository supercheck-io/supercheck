import { render, screen } from "@testing-library/react";
import { SRE_CONNECTOR_TYPES } from "@/lib/sre/connectors/connector-capabilities";
import {
  CONNECTOR_ICON_TYPES,
  ConnectorTypeIcon,
  ConnectorTypeLabel,
  connectorTypeLogo,
} from "./connector-logos";

describe("connector logos", () => {
  it("maps every connector type to an icon", () => {
    expect([...CONNECTOR_ICON_TYPES].sort()).toEqual(
      [...SRE_CONNECTOR_TYPES].sort(),
    );
  });

  it("renders an aria-hidden icon for each type", () => {
    for (const type of SRE_CONNECTOR_TYPES) {
      const { container, unmount } = render(<ConnectorTypeIcon type={type} />);
      const el = container.firstElementChild;
      expect(el).not.toBeNull();
      expect(
        el!.getAttribute("aria-hidden") === "true" ||
          el!.querySelector("svg")?.getAttribute("aria-hidden") === "true",
      ).toBe(true);
      unmount();
    }
  });

  it("renders label next to the icon", () => {
    const { container } = render(<ConnectorTypeLabel type="github" />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a hidden generic icon for unknown types", () => {
    const { container } = render(<ConnectorTypeIcon type="nope" />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("exposes a component per type for filter options", () => {
    const Icon = connectorTypeLogo("prometheus");
    const { container } = render(<Icon className="h-4 w-4" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

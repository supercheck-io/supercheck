import { fireEvent, render, screen } from "@testing-library/react";
import { TruncatedTextWithTooltip } from "./truncated-text-with-tooltip";

// jsdom has no layout, so fake the rendered widths: `clipped` decides whether text overflows.
let clipped = false;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => (clipped ? 200 : 50) });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 100 });
});
afterAll(() => {
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

it("shows the full text for short text that is still clipped, on hover and on keyboard focus", async () => {
  clipped = true;
  render(<TruncatedTextWithTooltip text="EU Central" maxLength={12} />);

  const trigger = screen.getByText("EU Central");
  expect(trigger).toHaveAttribute("tabindex", "0");

  fireEvent.mouseEnter(trigger);
  expect(await screen.findAllByText("EU Central")).toHaveLength(2);
  fireEvent.mouseLeave(trigger);

  fireEvent.focus(trigger);
  expect(await screen.findAllByText("EU Central")).toHaveLength(2);
});

it("adds no popover or tab stop for long text that fits", () => {
  clipped = false;
  render(<TruncatedTextWithTooltip text="a fairly long label that fits" maxLength={5} />);

  const text = screen.getByText("a fairly long label that fits");
  expect(text).not.toHaveAttribute("tabindex");
  fireEvent.mouseEnter(text);
  expect(screen.getAllByText("a fairly long label that fits")).toHaveLength(1);
});

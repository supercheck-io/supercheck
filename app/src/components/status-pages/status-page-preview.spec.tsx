import { fireEvent, render, screen } from "@testing-library/react";
import { StatusPagePreview } from "./status-page-preview";

it("opens the signed-in preview full screen, names the new-tab link, and closes with Escape", () => {
  render(<StatusPagePreview statusPageId="p1" statusPageName="Acme status" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /preview/i }));
  const dialog = screen.getByRole("dialog", { name: "Acme status" });
  expect(dialog.querySelector("iframe")).toHaveAttribute("src", "/status-pages/p1/public");
  expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", "/status-pages/p1/public");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("closes on Escape pressed inside the preview frame", () => {
  render(<StatusPagePreview statusPageId="p1" statusPageName="Acme status" />);
  fireEvent.click(screen.getByRole("button", { name: /preview/i }));
  const frame = screen.getByRole("dialog").querySelector("iframe")!;
  fireEvent.load(frame);
  fireEvent.keyDown(frame.contentDocument!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

import { fireEvent, render, screen } from "@testing-library/react";
import { ListCapNote, ListErrorState } from "./list-states";

it("ListErrorState shows the message and retries", () => {
  const onRetry = jest.fn();
  render(<ListErrorState title="Failed to fetch jobs" error={new Error("boom")} onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalled();
});

it("ListCapNote only renders when the cap is hit", () => {
  const { rerender } = render(<ListCapNote count={99} cap={100} />);
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<ListCapNote count={100} cap={100} />);
  expect(screen.getByRole("status")).toHaveTextContent("Showing the latest 100");
});

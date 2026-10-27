import { fireEvent, render, screen } from "@testing-library/react";

import { ListPagination } from "./list-pagination";

function setup(overrides = {}) {
  const props = {
    total: 40,
    itemName: "members",
    pageIndex: 1,
    pageSize: 12,
    pageCount: 4,
    onPageChange: jest.fn(),
    onPageSizeChange: jest.fn(),
    ...overrides,
  };
  render(<ListPagination {...props} />);
  return props;
}

it("shows totals and the current page", () => {
  setup();
  expect(screen.getByText("Total 40 members")).toBeInTheDocument();
  expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
});

it("moves between pages", () => {
  const props = setup();
  fireEvent.click(screen.getByRole("button", { name: "Go to previous page" }));
  fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
  fireEvent.click(screen.getByRole("button", { name: "Go to last page" }));
  expect(props.onPageChange.mock.calls).toEqual([[0], [2], [3]]);
});

it("disables navigation at the edges", () => {
  setup({ pageIndex: 0, pageCount: 1 });
  expect(screen.getByRole("button", { name: "Go to previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Go to next page" })).toBeDisabled();
});

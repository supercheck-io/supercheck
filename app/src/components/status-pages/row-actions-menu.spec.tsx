import { fireEvent, render, screen } from "@testing-library/react";
import { Pencil, Trash2 } from "lucide-react";
import { RowActionsMenu } from "./row-actions-menu";

const open = () => fireEvent.keyDown(screen.getByRole("button", { name: "Actions for API" }), { key: "Enter" });

it("runs the chosen action and separates the destructive one", async () => {
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  render(
    <RowActionsMenu
      label="Actions for API"
      actions={[
        { label: "Edit", icon: Pencil, onSelect: onEdit },
        { label: "Delete", icon: Trash2, destructive: true, onSelect: onDelete },
      ]}
    />,
  );
  open();
  const del = await screen.findByRole("menuitem", { name: "Delete" });
  expect(screen.getByRole("separator")).toBeInTheDocument();
  expect(del).toHaveClass("text-failure");
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onEdit).not.toHaveBeenCalled();
});

it("disables the trigger while busy and renders nothing without actions", () => {
  const { rerender, container } = render(
    <RowActionsMenu label="Actions for API" busy actions={[{ label: "Edit", icon: Pencil, onSelect: jest.fn() }]} />,
  );
  expect(screen.getByRole("button", { name: "Actions for API" })).toBeDisabled();
  rerender(<RowActionsMenu label="Actions for API" actions={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it("does not run a disabled action", async () => {
  const onEdit = jest.fn();
  render(<RowActionsMenu label="Actions for API" actions={[{ label: "Edit", icon: Pencil, disabled: true, onSelect: onEdit }]} />);
  open();
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
  expect(onEdit).not.toHaveBeenCalled();
});

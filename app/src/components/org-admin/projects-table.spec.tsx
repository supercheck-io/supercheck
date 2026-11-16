import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectsTable } from "./projects-table";
import type { Project } from "./project-columns";

const rows: Project[] = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`, name: `Project ${String(i).padStart(2, "0")}`, membersCount: 1, createdAt: "2026-01-01T00:00:00Z", isDefault: i === 0,
}));

it("a search from a later page shows its match instead of an empty page", async () => {
  render(<ProjectsTable projects={rows} onCreateProject={jest.fn()} />);
  const search = await screen.findByPlaceholderText(/search projects/i);
  const next = screen.getAllByRole("button").find((b) => /next page/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`));
  expect(next).toBeDefined();
  fireEvent.click(next!);
  expect(screen.queryByText("Project 03")).toBeNull(); // really on a later page
  fireEvent.change(search, { target: { value: "Project 03" } });
  expect(await screen.findByText("Project 03")).toBeTruthy();
  expect(screen.queryByText(/No matching projects/i)).toBeNull();
});

it("an open row menu survives a parent re-render with new handler functions", async () => {
  const props = (edit: jest.Mock) => ({ projects: rows.slice(1, 2), onCreateProject: jest.fn(), canManageProject: true, onEditProject: (p: Project) => edit(p) });
  const edit = jest.fn();
  const { rerender } = render(<ProjectsTable {...props(edit)} />);
  const trigger = await screen.findByRole("button", { name: /^Open actions for/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(await screen.findByRole("menuitem", { name: "Edit project" })).toBeTruthy();
  rerender(<ProjectsTable {...props(edit)} />); // a fresh lambda, as the org-admin page passes on every render
  const item = screen.getByRole("menuitem", { name: "Edit project" });
  fireEvent.click(item);
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
});

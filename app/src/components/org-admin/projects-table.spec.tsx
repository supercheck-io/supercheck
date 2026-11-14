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

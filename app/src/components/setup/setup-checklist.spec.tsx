import { render, screen } from "@testing-library/react";

import { SetupChecklist } from "./setup-checklist";

const item = (key: string, group: "watch" | "prove" | "fix" | "team", done: boolean) => ({ key, group, title: `Title ${key}`, done, href: `/${key}` });

describe("SetupChecklist", () => {
  it("groups items, marks done state for screen readers and links Set up or View", () => {
    render(<SetupChecklist checklist={{ items: [item("a", "watch", true), item("b", "team", false)], done: 1, total: 2, nextSteps: [] }} />);
    expect(screen.getByRole("heading", { name: "Watch it" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Team and code" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Prove it" })).toBeNull();
    expect(screen.getByText("(done)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe("/a");
    expect(screen.getByRole("link", { name: "Set up" }).getAttribute("href")).toBe("/b");
  });

  it("lists next steps as not counted, opening docs links in a new tab", () => {
    render(
      <SetupChecklist
        checklist={{
          items: [],
          done: 0,
          total: 0,
          nextSteps: [{ key: "i", title: "Practice", href: "/incidents?new=1" }, { key: "r", title: "Recipe", href: "https://supercheck.io/docs" }],
        }}
      />,
    );
    expect(screen.getByText(/not counted/)).toBeTruthy();
    const [internal, external] = screen.getAllByRole("link", { name: /Open/ });
    expect(internal.getAttribute("target")).toBeNull();
    expect(external.getAttribute("target")).toBe("_blank");
  });

  it("says so when there is nothing to show", () => {
    render(<SetupChecklist checklist={{ items: [], done: 0, total: 0, nextSteps: [] }} />);
    expect(screen.getByText("Nothing to set up yet.")).toBeTruthy();
  });
});

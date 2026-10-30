import React from "react";
import { render, screen } from "@testing-library/react";
import { createMemberColumns, type OrgMember } from "./member-columns";

jest.mock("@/components/members/MemberAccessDialog", () => ({ MemberAccessDialog: () => null }));

const member = (id: string, role: OrgMember["role"]) =>
  ({ type: "member", id, name: `N-${id}`, email: `${id}@x.io`, role, image: null, joinedAt: new Date().toISOString(), projects: [] }) as unknown as OrgMember;

function renderActions(m: OrgMember, currentUserId: string, currentUserRole: string) {
  const col = createMemberColumns(jest.fn(), [], currentUserId, currentUserRole).find((c) => c.id === "actions")!;
  const cell = col.cell as (ctx: unknown) => React.ReactElement;
  render(cell({ row: { original: m } }));
}

describe("member actions cell", () => {
  it("offers actions on another member's row", () => {
    renderActions(member("u2", "project_editor"), "u1", "org_admin");
    expect(screen.getByLabelText("Open actions for N-u2")).toBeTruthy();
  });

  it("hides actions on the viewer's own row", () => {
    renderActions(member("u1", "project_editor"), "u1", "org_admin");
    expect(screen.queryByLabelText(/Open actions/)).toBeNull();
  });

  it("hides actions on org_admin rows unless the viewer is org_owner", () => {
    renderActions(member("u2", "org_admin"), "u1", "org_admin");
    expect(screen.queryByLabelText(/Open actions/)).toBeNull();
  });

  it("lets an org_owner act on org_admin rows", () => {
    renderActions(member("u2", "org_admin"), "u1", "org_owner");
    expect(screen.getByLabelText("Open actions for N-u2")).toBeTruthy();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import { MembersTable } from "./members-table";

jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
jest.mock("@/components/members/MemberAccessDialog", () => ({ MemberAccessDialog: () => null }));

const member = (id: string, role: string) =>
  ({ type: "member", id, name: `N-${id}`, email: `${id}@x.io`, role, image: null, joinedAt: new Date().toISOString(), projects: [] }) as never;

describe("MembersTable", () => {
  it("threads currentUserRole so an org_owner can act on org_admin rows but not their own", async () => {
    render(
      <MembersTable
        members={[member("u1", "org_owner"), member("u2", "org_admin")]}
        onMemberUpdate={jest.fn()}
        onInviteMember={jest.fn()}
        currentUserRole="org_owner"
      />,
    );
    expect(await screen.findByLabelText("Open actions for N-u2")).toBeTruthy();
    expect(screen.queryByLabelText("Open actions for N-u1")).toBeNull();
  });
});

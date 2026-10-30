import React from "react";
import { render, screen } from "@testing-library/react";
import { MemberAccessDialog } from "./MemberAccessDialog";

const renderDialog = (actorRole?: string) =>
  render(<MemberAccessDialog open onOpenChange={jest.fn()} mode="invite" projects={[]} onSubmit={jest.fn()} actorRole={actorRole} />);

describe("MemberAccessDialog role options", () => {
  it("does not offer Org Admin to an org_admin actor", () => {
    renderDialog("org_admin");
    expect(screen.getByText("Viewer")).toBeTruthy();
    expect(screen.queryByText("Org Admin")).toBeNull();
  });

  it("offers Org Admin to an org_owner actor", () => {
    renderDialog("org_owner");
    expect(screen.getByText("Org Admin")).toBeTruthy();
  });
});

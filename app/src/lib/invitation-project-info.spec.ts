import { buildInvitationProjectInfo } from "./invitation-project-info";

describe("buildInvitationProjectInfo", () => {
  it("returns plain text; the email template escapes it when rendering", () => {
    expect(buildInvitationProjectInfo("project_editor", ["<b>x</b>"])).toBe(
      "You'll have editor permissions in the <b>x</b> project. Other active projects in this team remain visible with read-only access.",
    );
  });

  it("lists several projects and omits the read-only note for other roles", () => {
    expect(buildInvitationProjectInfo("project_viewer", ["A", "B"])).toBe(
      "You'll have editor permissions in the following projects: A, B.",
    );
  });
});

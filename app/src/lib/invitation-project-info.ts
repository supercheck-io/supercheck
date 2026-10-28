/** Email sentence describing which projects an invitee will be assigned to. */
export function buildInvitationProjectInfo(role: string, projectNames: string[]): string {
  const roleRequiresProjectAssignments = role === "project_admin" || role === "project_editor";
  const permission = role === "project_admin" ? "project admin" : "editor";
  let projectInfo = "";
  if (projectNames.length === 1) {
    projectInfo = `You'll have ${permission} permissions in the <strong>${projectNames[0]}</strong> project.`;
  } else if (projectNames.length > 1) {
    projectInfo = `You'll have ${permission} permissions in the following projects: <strong>${projectNames.join(", ")}</strong>.`;
  }
  if (roleRequiresProjectAssignments) {
    projectInfo += " Other active projects in this team remain visible with read-only access.";
  }
  return projectInfo;
}

/** Invitations are never rewritten to 'expired' in the database; derive it from expiresAt. */
export function withEffectiveStatus<T extends { status: string; expiresAt: Date }>(invite: T): T {
  return invite.status === "pending" && invite.expiresAt.getTime() < Date.now() ? { ...invite, status: "expired" } : invite;
}

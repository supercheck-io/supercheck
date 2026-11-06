/** Plain-text sentence describing which projects an invitee will be assigned to (the email template escapes it). */
export function buildInvitationProjectInfo(role: string, projectNames: string[]): string {
  const roleRequiresProjectAssignments = role === "project_admin" || role === "project_editor";
  const permission = role === "project_admin" ? "project admin" : "editor";
  let projectInfo = "";
  if (projectNames.length === 1) {
    projectInfo = `You'll have ${permission} permissions in the ${projectNames[0]} project.`;
  } else if (projectNames.length > 1) {
    projectInfo = `You'll have ${permission} permissions in the following projects: ${projectNames.join(", ")}.`;
  }
  if (roleRequiresProjectAssignments) {
    projectInfo += " Other active projects in this team remain visible with read-only access.";
  }
  return projectInfo;
}

/** 'expired' is never stored; derive it from expiresAt. (Re-inviting an address marks its stale pending invitation 'cancelled'.) */
export function withEffectiveStatus<T extends { status: string; expiresAt: Date }>(invite: T): T {
  return invite.status === "pending" && invite.expiresAt.getTime() < Date.now() ? { ...invite, status: "expired" } : invite;
}

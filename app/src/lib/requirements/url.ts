export const REQUIREMENTS_PATH = "/requirements";

export function getRequirementDetailsPath(requirementId: string): string {
  const params = new URLSearchParams({ id: requirementId });
  return `${REQUIREMENTS_PATH}?${params.toString()}`;
}

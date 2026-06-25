import { formatSreSkillsForPrompt, loadSreSkill, resolveSreSkillPath } from "./skill-loader";

describe("SRE skill loader", () => {
  it("loads approved markdown skills from the SRE skills directory", () => {
    const skill = loadSreSkill("incident-triage");

    expect(skill.name).toBe("incident-triage");
    expect(skill.content).toContain("Incident Triage");
    expect(formatSreSkillsForPrompt([skill])).toContain("## Skill: incident-triage");
  });

  it("rejects path traversal and invalid names", () => {
    expect(() => resolveSreSkillPath("../secret")).toThrow("Invalid SRE skill name");
    expect(() => resolveSreSkillPath("incident_tr iage")).toThrow("Invalid SRE skill name");
  });
});

import { readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const MAX_SKILL_BYTES = 48_000;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;

export type SreSkill = {
  name: string;
  content: string;
};

function skillsDirectory() {
  return join(process.cwd(), "src", "sre", "skills");
}

export function resolveSreSkillPath(name: string) {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error("Invalid SRE skill name");
  }

  const base = skillsDirectory();
  const resolved = normalize(join(base, `${name}.md`));
  if (resolved !== join(base, `${name}.md`) || !resolved.startsWith(`${base}${sep}`)) {
    throw new Error("Invalid SRE skill path");
  }

  return resolved;
}

export function loadSreSkill(name: string): SreSkill {
  const path = resolveSreSkillPath(name);
  const content = readFileSync(path, { encoding: "utf8" });
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BYTES) {
    throw new Error(`SRE skill ${name} exceeds ${MAX_SKILL_BYTES} byte limit`);
  }

  return { name, content };
}

export function loadSreSkills(names: string[]) {
  return names.map(loadSreSkill);
}

export function formatSreSkillsForPrompt(skills: SreSkill[]) {
  if (skills.length === 0) {
    return "";
  }

  return skills.map((skill) => `## Skill: ${skill.name}\n\n${skill.content.trim()}`).join("\n\n---\n\n");
}

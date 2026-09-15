const LABEL_NAME_PATTERN = /^[A-Za-z0-9](?:[-_.A-Za-z0-9]{0,61}[A-Za-z0-9])?$/;
const DNS_PREFIX_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?)*$/;

function isValidLabelKey(value: string) {
  const [prefix, name, extra] = value.trim().split("/");
  if (extra !== undefined) return false;

  if (name === undefined) {
    return LABEL_NAME_PATTERN.test(prefix);
  }

  return DNS_PREFIX_PATTERN.test(prefix) && LABEL_NAME_PATTERN.test(name);
}

function isValidLabelValue(value: string) {
  const trimmed = value.trim();
  return trimmed === "" || LABEL_NAME_PATTERN.test(trimmed);
}

function splitRequirements(selector: string) {
  const requirements: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return null;

    if (character === "," && depth === 0) {
      requirements.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (depth !== 0) return null;
  requirements.push(selector.slice(start).trim());
  return requirements.every(Boolean) ? requirements : null;
}

function isValidRequirement(requirement: string) {
  const setMatch = requirement.match(/^(.+?)\s+(in|notin)\s+\((.*)\)$/);
  if (setMatch) {
    const [, key, , rawValues] = setMatch;
    const values = rawValues.split(",").map((value) => value.trim());
    return (
      isValidLabelKey(key) &&
      values.length > 0 &&
      values.every((value) => value.length > 0 && isValidLabelValue(value))
    );
  }

  const equalityMatch = requirement.match(/^(.+?)(==|!=|=)(.*)$/);
  if (equalityMatch) {
    const [, key, , value] = equalityMatch;
    return isValidLabelKey(key) && isValidLabelValue(value);
  }

  if (requirement.startsWith("!")) {
    return isValidLabelKey(requirement.slice(1));
  }

  return isValidLabelKey(requirement);
}

export function isValidKubernetesLabelSelector(query: string) {
  const selector = query.trim();
  if (selector === "*") return true;
  if (!selector || /[{}\[\]"'~\r\n]/.test(selector)) return false;
  if (/\b(?:metadata|spec|status)\./i.test(selector)) return false;

  const requirements = splitRequirements(selector);
  return Boolean(
    requirements?.every((requirement) => isValidRequirement(requirement)),
  );
}

/**
 * Limits on what an unauthenticated client may register, and how a client's
 * self-chosen name is shown.
 *
 * Dynamic registration is open to anyone, and every field is stored and later
 * shown to users. Without limits one request can store a 100 KB name or hundreds
 * of redirect URIs, and a NUL byte makes PostgreSQL reject the insert, which
 * surfaced as an empty 500 plus a logged database error.
 */
export const REGISTRATION_LIMITS = {
  nameLength: 100,
  urlLength: 2048,
  redirectUris: 10,
  shortField: 256,
  contacts: 10,
} as const;

// C0/C1 control characters (including NUL) and the bidirectional overrides and isolates, which can
// make one name read as another or reorder surrounding text.
const CONTROL_OR_BIDI = /[\p{Cc}‪-‮⁦-⁩]/u;

// The URI fields that a client-controlled link could be built from.
const LINK_FIELDS = ["client_uri", "logo_uri", "tos_uri", "policy_uri"] as const;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns why a registration request must be refused, or null when it is acceptable.
 * Works on the raw request body, before anything is stored.
 */
export function registrationProblem(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The request body must be a JSON object";
  const input = body as Record<string, unknown>;
  const { nameLength, urlLength, redirectUris, shortField, contacts } = REGISTRATION_LIMITS;

  const text = (field: string, value: unknown, max: number): string | null => {
    if (typeof value !== "string") return `${field} must be a string`;
    if (value.length > max) return `${field} must be at most ${max} characters`;
    if (CONTROL_OR_BIDI.test(value)) return `${field} must not contain control or bidirectional formatting characters`;
    return null;
  };

  if (input.client_name !== undefined) {
    const problem = text("client_name", input.client_name, nameLength);
    if (problem) return problem;
  }

  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return "redirect_uris must be a non-empty array";
  if (uris.length > redirectUris) return `redirect_uris may contain at most ${redirectUris} entries`;
  for (const uri of uris) {
    const problem = text("redirect_uris entry", uri, urlLength);
    if (problem) return problem;
  }

  for (const field of LINK_FIELDS) {
    if (input[field] === undefined) continue;
    const problem = text(field, input[field], urlLength);
    if (problem) return problem;
    // These become links; javascript:, data: and plain http are not acceptable.
    if (!isHttpsUrl(input[field] as string)) return `${field} must be an https URL`;
  }

  for (const field of ["software_id", "software_version"] as const) {
    if (input[field] === undefined) continue;
    const problem = text(field, input[field], shortField);
    if (problem) return problem;
  }

  if (input.contacts !== undefined) {
    if (!Array.isArray(input.contacts) || input.contacts.length > contacts) {
      return `contacts must be an array of at most ${contacts} entries`;
    }
    for (const contact of input.contacts) {
      const problem = text("contacts entry", contact, shortField);
      if (problem) return problem;
    }
  }

  return null;
}

/**
 * A client-chosen name made safe to show: invisible control and formatting
 * characters (zero-width, bidirectional overrides) are removed so one app's name
 * cannot read as another's, and it is shortened.
 */
export function displayClientName(value: string | null | undefined, max = 80): string {
  const clean = (value ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

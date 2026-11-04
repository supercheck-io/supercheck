import { hashConnectorPayload } from "./connector-base";
import { redactConnectorText } from "./output-sanitizer";

export type DiagnosticQueryType = "promql" | "logql" | "traceql" | "http_get";
export type DiagnosticQueryParameterValue = string | number | boolean | null;
export type DiagnosticQueryParameters = Record<string, DiagnosticQueryParameterValue>;
export type DiagnosticQueryParameterType = "string" | "number" | "boolean" | "date" | "duration";

export type DiagnosticQueryDefinition = {
  id: string;
  queryType: DiagnosticQueryType;
  template: string;
  parameterSchema: Record<string, unknown>;
  allowlist: Record<string, unknown>;
  maxRows: number;
  maxBytes: number;
  maxSeconds: number;
};

export type RenderedDiagnosticQuery = {
  queryId: string;
  queryType: DiagnosticQueryType;
  query: string;
  inputHash: string;
  inputSummary: string;
  effectiveLimits: {
    maxRows: number;
    maxBytes: number;
    maxSeconds: number;
  };
};

const TEMPLATE_PARAM_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
const PARAMETER_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DURATION_PARAMETER_PATTERN = /^[1-9]\d{0,5}(ms|s|m|h|d|w)$/;
const SUPPORTED_PARAMETER_TYPES = new Set<DiagnosticQueryParameterType>(["string", "number", "boolean", "date", "duration"]);
const SUPPORTED_SCHEMA_KEYS = new Set(["type", "enum", "default", "required", "min", "max", "maxLength", "pattern", "allowParens"]);

type NormalizedParameterSchema = {
  type: DiagnosticQueryParameterType;
  enum?: DiagnosticQueryParameterValue[];
  default?: DiagnosticQueryParameterValue;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  allowParens?: boolean;
};

/**
 * Validates that every placeholder in a template has a corresponding key
 * in the allowlist. This is a write-time guard so admins cannot store
 * templates with unconstrained parameters. The executor re-validates at
 * runtime, but catching this early prevents unsafe definitions from
 * being stored at all.
 */
export function validateTemplatePlaceholderCoverage(
  template: string,
  allowlist: Record<string, unknown>
): void {
  const allowlistKeys = new Set(Object.keys(allowlist));
  const referencedKeys = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(TEMPLATE_PARAM_PATTERN.source, TEMPLATE_PARAM_PATTERN.flags);

  while ((match = pattern.exec(template)) !== null) {
    const name = match[1] ?? match[2];
    if (!name) continue;

    referencedKeys.add(name);

    if (!allowlistKeys.has(name)) {
      throw new Error(`Diagnostic query template references parameter "${name}" which is not in the allowlist`);
    }
  }

  if (referencedKeys.size === 0) {
    throw new Error("Diagnostic query template must contain at least one parameter placeholder");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isParameterType(value: unknown): value is DiagnosticQueryParameterType {
  return typeof value === "string" && SUPPORTED_PARAMETER_TYPES.has(value as DiagnosticQueryParameterType);
}

function isValueTypeCompatible(value: DiagnosticQueryParameterValue, type: DiagnosticQueryParameterType) {
  if (value === null) {
    return true;
  }

  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  if (type === "boolean") {
    return typeof value === "boolean";
  }

  return typeof value === "string";
}

function validateDateParameter(name: string, value: string) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Diagnostic query parameter "${name}" must be a valid date/time string`);
  }
}

function validateDurationParameter(name: string, value: string) {
  if (!DURATION_PARAMETER_PATTERN.test(value)) {
    throw new Error(`Diagnostic query parameter "${name}" must be a bounded duration such as 5m or 1h`);
  }
}

function normalizeParameterSchemaEntry(name: string, schemaValue: unknown): NormalizedParameterSchema | null {
  if (schemaValue === undefined || schemaValue === null) {
    return null;
  }

  if (isParameterType(schemaValue)) {
    return { type: schemaValue };
  }

  if (!isRecord(schemaValue)) {
    throw new Error(`Diagnostic query parameter schema for "${name}" must be a supported type string or object`);
  }

  for (const key of Object.keys(schemaValue)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" contains unsupported key "${key}"`);
    }
  }

  if (!isParameterType(schemaValue.type)) {
    throw new Error(`Diagnostic query parameter schema for "${name}" must define a supported type`);
  }

  const normalized: NormalizedParameterSchema = { type: schemaValue.type };

  if (schemaValue.required !== undefined) {
    if (typeof schemaValue.required !== "boolean") {
      throw new Error(`Diagnostic query parameter schema for "${name}" has invalid required flag`);
    }
    normalized.required = schemaValue.required;
  }

  if (schemaValue.enum !== undefined) {
    if (!Array.isArray(schemaValue.enum) || schemaValue.enum.length === 0 || schemaValue.enum.length > 50) {
      throw new Error(`Diagnostic query parameter schema for "${name}" enum must contain 1 to 50 values`);
    }

    const enumValues = schemaValue.enum.map((entry) => {
      if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean" && entry !== null) {
        throw new Error(`Diagnostic query parameter schema for "${name}" enum contains an unsupported value`);
      }
      if (!isValueTypeCompatible(entry, normalized.type)) {
        throw new Error(`Diagnostic query parameter schema for "${name}" enum values must match ${normalized.type}`);
      }
      return entry;
    });

    normalized.enum = enumValues;
  }

  if (schemaValue.default !== undefined) {
    if (typeof schemaValue.default !== "string" && typeof schemaValue.default !== "number" && typeof schemaValue.default !== "boolean" && schemaValue.default !== null) {
      throw new Error(`Diagnostic query parameter schema for "${name}" default contains an unsupported value`);
    }
    if (!isValueTypeCompatible(schemaValue.default, normalized.type)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" default must match ${normalized.type}`);
    }
    normalized.default = schemaValue.default;
  }

  if (schemaValue.min !== undefined || schemaValue.max !== undefined) {
    if (normalized.type !== "number") {
      throw new Error(`Diagnostic query parameter schema for "${name}" min/max are only supported for number parameters`);
    }

    if (schemaValue.min !== undefined) {
      if (typeof schemaValue.min !== "number" || !Number.isFinite(schemaValue.min)) {
        throw new Error(`Diagnostic query parameter schema for "${name}" has invalid min`);
      }
      normalized.min = schemaValue.min;
    }

    if (schemaValue.max !== undefined) {
      if (typeof schemaValue.max !== "number" || !Number.isFinite(schemaValue.max)) {
        throw new Error(`Diagnostic query parameter schema for "${name}" has invalid max`);
      }
      normalized.max = schemaValue.max;
    }

    if (normalized.min !== undefined && normalized.max !== undefined && normalized.min > normalized.max) {
      throw new Error(`Diagnostic query parameter schema for "${name}" min cannot exceed max`);
    }
  }

  if (schemaValue.maxLength !== undefined) {
    if (!["string", "date", "duration"].includes(normalized.type)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" maxLength is only supported for string-like parameters`);
    }
    const maxLength = schemaValue.maxLength;
    if (typeof maxLength !== "number" || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 500) {
      throw new Error(`Diagnostic query parameter schema for "${name}" has invalid maxLength`);
    }
    normalized.maxLength = maxLength;
  }

  if (schemaValue.pattern !== undefined) {
    if (!["string", "date", "duration"].includes(normalized.type)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" pattern is only supported for string-like parameters`);
    }
    if (typeof schemaValue.pattern !== "string" || schemaValue.pattern.length === 0 || schemaValue.pattern.length > 200) {
      throw new Error(`Diagnostic query parameter schema for "${name}" has invalid pattern`);
    }

    try {
      new RegExp(schemaValue.pattern);
    } catch {
      throw new Error(`Diagnostic query parameter schema for "${name}" has invalid pattern`);
    }
    if (isUnsafePattern(schemaValue.pattern)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" pattern is too complex (nested quantifiers)`);
    }

    normalized.pattern = schemaValue.pattern;
  }

  if (schemaValue.allowParens !== undefined) {
    if (schemaValue.allowParens !== true || normalized.type !== "string" || !normalized.pattern) {
      throw new Error(`Diagnostic query parameter schema for "${name}" allowParens must be true and requires a string parameter with a pattern`);
    }
    normalized.allowParens = true;
  }

  return normalized;
}

// JS regexes have no timeout. Reject a quantified group that itself contains a
// quantifier (e.g. (a+)+, (a*)*), the classic catastrophic-backtracking shape,
// and bound the input a pattern is tested against.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/;
const MAX_PATTERN_INPUT_LENGTH = 1000;

/** Heuristic only: catches nested quantifiers, not every ReDoS shape (e.g. overlapping alternation). */
function isUnsafePattern(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern);
}

export function validateDiagnosticQueryParameterSchema(parameterSchema: Record<string, unknown>): void {
  const keys = Object.keys(parameterSchema);
  if (keys.length > 25) {
    throw new Error("Diagnostic query parameter schema cannot define more than 25 parameters");
  }

  for (const name of keys) {
    if (!PARAMETER_NAME_PATTERN.test(name)) {
      throw new Error(`Diagnostic query parameter schema contains invalid parameter name "${name}"`);
    }
    const schema = normalizeParameterSchemaEntry(name, parameterSchema[name]);
    // Write-time only: saved broad patterns still load; they never exempt a value from the render-time free-text checks.
    if (schema?.pattern && isOverBroadPattern(schema.pattern)) {
      throw new Error(`Diagnostic query parameter schema for "${name}" pattern is too broad: it accepts quotes, braces, backslashes or newlines`);
    }
    if (schema && "default" in schema) {
      validateParameterValue(name, schema.default ?? null, parameterSchema[name]);
    }
  }
}

function validateParameterValue(name: string, value: DiagnosticQueryParameterValue, schemaValue: unknown) {
  const schema = normalizeParameterSchemaEntry(name, schemaValue);

  if (schema && value === null) {
    if (schema.required === false) {
      return;
    }
    throw new Error(`Diagnostic query parameter "${name}" cannot be null`);
  }

  if (schema && !isValueTypeCompatible(value, schema.type)) {
    throw new Error(`Diagnostic query parameter "${name}" must be ${schema.type}`);
  }

  if (typeof value === "string" && value.length > 500) {
    throw new Error(`Diagnostic query parameter "${name}" is too long`);
  }

  if (!schema || value === null) {
    return;
  }

  if (schema.type === "date" && typeof value === "string") {
    validateDateParameter(name, value);
  }

  if (schema.type === "duration" && typeof value === "string") {
    validateDurationParameter(name, value);
  }

  if (typeof value === "number") {
    if (schema.min !== undefined && value < schema.min) {
      throw new Error(`Diagnostic query parameter "${name}" must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      throw new Error(`Diagnostic query parameter "${name}" must be at most ${schema.max}`);
    }
  }

  if (typeof value === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new Error(`Diagnostic query parameter "${name}" is too long`);
    }
    if (schema.pattern && value.length > MAX_PATTERN_INPUT_LENGTH) {
      throw new Error(`Diagnostic query parameter "${name}" is too long`);
    }
    // Patterns saved before the schema-time check existed are not rewritten, so
    // re-check here, where the regex actually runs.
    if (schema.pattern && isUnsafePattern(schema.pattern)) {
      throw new Error(`Diagnostic query parameter "${name}" has a pattern that is too complex to evaluate`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      throw new Error(`Diagnostic query parameter "${name}" does not match its required pattern`);
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`Diagnostic query parameter "${name}" is not in the schema enum`);
  }
}

function validateAllowlist(name: string, value: DiagnosticQueryParameterValue, allowlistValue: unknown) {
  if (!Array.isArray(allowlistValue)) {
    return;
  }

  const allowed = allowlistValue.filter((entry): entry is string | number | boolean => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean");
  const stringifiedAllowed = allowed.map(String);
  if (stringifiedAllowed.length > 0 && !stringifiedAllowed.includes(String(value))) {
    throw new Error(`Diagnostic query parameter "${name}" is not allowlisted`);
  }
}

function formatParameterValue(value: DiagnosticQueryParameterValue) {
  if (value === null) {
    return "";
  }

  return String(value);
}

// Values are spliced into the template verbatim, so free-text strings (no pattern, enum or allowlist)
// must not carry query syntax that could escape the template's label/field constraints.
const UNSAFE_FREE_TEXT = /["'`{}\\\n\r;]/;
// An unquoted position has no delimiter to escape from, so operators, spaces, parens and pipes are
// enough to change the query. Free text there must be a plain token.
const UNQUOTED_SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]+$/;
// Opt-in per parameter (allowParens, http_get only): Azure resource names may contain parentheses, legal in a URL path.
const UNQUOTED_SAFE_TOKEN_PARENS = /^[A-Za-z0-9_.:/@()-]+$/;
// Parens are query syntax for every other adapter, so the flag is honored only for http_get.
const parensAllowed = (schema: NormalizedParameterSchema | null, queryType?: DiagnosticQueryType) =>
  Boolean(schema?.allowParens) && queryType === "http_get";
// Values containing a character UNSAFE_FREE_TEXT rejects. A pattern that accepts any of them is not
// constraining the value (".*", "^.+$", "[^x]+").
const BROAD_PATTERN_CANARIES = ['a"b', "a'b", "a`b", "a{b}", "a\\b", "a\nb", "a;b", '"} or vector(1) #'];
const NEGATED_CLASS = /\[\^(?:[^\]\\]|\\.)*\]/g;
// Query-syntax characters written literally in the pattern (outside a negated class) mean it accepts them.
const SYNTAX_LITERAL = /["'`#;]|\\[{}\\nrxu0]/;

/** Save-time check: true when the pattern accepts values with query-syntax characters. */
export function isOverBroadPattern(pattern: string): boolean {
  try {
    const re = new RegExp(pattern);
    return BROAD_PATTERN_CANARIES.some((canary) => re.test(canary)) || SYNTAX_LITERAL.test(pattern.replace(NEGATED_CLASS, ""));
  } catch {
    return false;
  }
}

const NON_TOKEN_CANARIES = [" ", "(", ")", "|", "=", "!", "<", ">", ",", "+", "*", "?", "&", "$", "%", "~", "[", "]"].map((c) => `a${c}a`);

function acceptsNonToken(pattern: string, allowParens = false): boolean {
  try {
    const re = new RegExp(pattern);
    return NON_TOKEN_CANARIES.filter((c) => !(allowParens && /[()]/.test(c))).some((canary) => re.test(canary));
  } catch {
    return true;
  }
}

const hasHashComments = (queryType?: DiagnosticQueryType) => queryType === "promql" || queryType === "logql";

/** Whether the template position at `offset` is inside a quoted string ("...", '...' or `...`). */
function isInsideQuotes(template: string, offset: number, hashComments = false): boolean {
  let open: string | null = null;
  for (let i = 0; i < offset; i++) {
    const ch = template[i];
    if (!open && hashComments && ch === "#") {
      // PromQL and LogQL: a # outside a string comments out the rest of the line, so quotes in it do not count.
      while (i < offset && template[i] !== "\n") i++;
      continue;
    }
    if (open) {
      // A backslash escapes only in "..." and '...' strings; backtick strings are raw.
      if (ch === "\\" && open !== "`") i++;
      else if (ch === open) open = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      open = ch;
    }
  }
  return open !== null;
}

// Only values the admin fixed up front (enum or allowlist) are exempt from the free-text checks.
// A pattern is not: it can be loose, or accept query syntax, so it never replaces the guard.
function isConstrainedFreeText(schema: NormalizedParameterSchema | null, allowlistValue: unknown) {
  return Boolean(schema?.enum || (Array.isArray(allowlistValue) && allowlistValue.length > 0));
}

function rejectUnsafeFreeText(
  name: string,
  value: DiagnosticQueryParameterValue,
  schemaValue: unknown,
  allowlistValue: unknown,
  quoted: boolean,
  queryType?: DiagnosticQueryType,
) {
  if (typeof value !== "string") return;
  const schema = normalizeParameterSchemaEntry(name, schemaValue);
  if (isConstrainedFreeText(schema, allowlistValue)) return;
  if (UNSAFE_FREE_TEXT.test(value)) {
    throw new Error(`Diagnostic query parameter "${name}" contains disallowed characters`);
  }
  // Typed date/duration values are validated by their own parsers.
  if (!quoted && (!schema || schema.type === "string") && value !== "" && (!(parensAllowed(schema, queryType) ? UNQUOTED_SAFE_TOKEN_PARENS : UNQUOTED_SAFE_TOKEN).test(value) || value.includes(".."))) {
    throw new Error(`Diagnostic query parameter "${name}" is unquoted free text and may only contain letters, digits and _ . : / @ -`);
  }
}

/**
 * Write-time guard: an unconstrained string parameter must sit inside quotes in the template.
 * Saved definitions are not rewritten; at runtime they keep working for plain-token values only.
 */
export function validateTemplateFreeTextPositions(
  template: string,
  parameterSchema: Record<string, unknown>,
  allowlist: Record<string, unknown>,
  queryType?: DiagnosticQueryType,
): void {
  const hashComments = hasHashComments(queryType);
  const pattern = new RegExp(TEMPLATE_PARAM_PATTERN.source, TEMPLATE_PARAM_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    const name = match[1] ?? match[2];
    if (!name) continue;
    const schema = normalizeParameterSchemaEntry(name, parameterSchema[name]);
    if (schema && schema.type !== "string") continue;
    if (isConstrainedFreeText(schema, allowlist[name])) continue;
    if (!isInsideQuotes(template, match.index, hashComments)) {
      // A pattern that only admits plain tokens is consistent with the render-time token rule.
      if (schema?.pattern && !acceptsNonToken(schema.pattern, parensAllowed(schema, queryType))) continue;
      throw new Error(
        `Diagnostic query parameter "${name}" is free text in an unquoted position; add an enum or allowlist, a pattern that admits only plain tokens, or put the placeholder inside quotes`,
      );
    }
  }
}

function parameterDefault(name: string, schemaValue: unknown): DiagnosticQueryParameterValue | undefined {
  const schema = normalizeParameterSchemaEntry(name, schemaValue);
  if (!schema || !("default" in schema)) {
    return undefined;
  }

  return schema.default;
}

const SUPPORTED_QUERY_TYPES: ReadonlySet<string> = new Set<DiagnosticQueryType>(["promql", "logql", "traceql", "http_get"]);

export function assertReadOnlyDiagnosticQuery(queryType: DiagnosticQueryType, renderedQuery: string) {
  const trimmed = renderedQuery.trim();
  if (!trimmed) {
    throw new Error("Diagnostic query rendered to an empty query");
  }

  // Rows saved before "sql" was removed must fail closed rather than run unvalidated.
  if (!SUPPORTED_QUERY_TYPES.has(queryType)) {
    throw new Error(`Unsupported diagnostic query type "${queryType}"`);
  }
}

export function renderDiagnosticQueryTemplate(definition: DiagnosticQueryDefinition, parameters: DiagnosticQueryParameters): RenderedDiagnosticQuery {
  const referencedParameters = new Set<string>();
  const renderedQuery = definition.template.replace(TEMPLATE_PARAM_PATTERN, (_match, braceName: string | undefined, dollarName: string | undefined, offset: number) => {
    const name = braceName ?? dollarName;
    if (!name) {
      throw new Error("Invalid diagnostic query placeholder");
    }

    const value = name in parameters ? parameters[name] : parameterDefault(name, definition.parameterSchema[name]);
    if (value === undefined) {
      throw new Error(`Missing diagnostic query parameter "${name}"`);
    }
    validateParameterValue(name, value, definition.parameterSchema[name]);
    validateAllowlist(name, value, definition.allowlist[name]);
    rejectUnsafeFreeText(name, value, definition.parameterSchema[name], definition.allowlist[name], isInsideQuotes(definition.template, offset, hasHashComments(definition.queryType)), definition.queryType);
    referencedParameters.add(name);
    return formatParameterValue(value);
  });

  for (const name of Object.keys(parameters)) {
    if (!referencedParameters.has(name)) {
      throw new Error(`Unexpected diagnostic query parameter "${name}"`);
    }
  }

  if (renderedQuery.length > 5000) {
    throw new Error("Rendered diagnostic query is too long");
  }

  assertReadOnlyDiagnosticQuery(definition.queryType, renderedQuery);

  const input = {
    queryId: definition.id,
    queryType: definition.queryType,
    parameters,
    renderedQuery,
    limits: {
      maxRows: definition.maxRows,
      maxBytes: definition.maxBytes,
      maxSeconds: definition.maxSeconds,
    },
  };

  return {
    queryId: definition.id,
    queryType: definition.queryType,
    query: renderedQuery,
    inputHash: hashConnectorPayload(input),
    inputSummary: redactConnectorText(JSON.stringify({ queryId: definition.id, queryType: definition.queryType, parameters, renderedQuery })),
    effectiveLimits: {
      maxRows: Math.min(definition.maxRows, 100),
      maxBytes: Math.min(definition.maxBytes, 1_048_576),
      maxSeconds: Math.min(definition.maxSeconds, 15),
    },
  };
}

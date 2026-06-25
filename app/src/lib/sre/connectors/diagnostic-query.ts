import { hashConnectorPayload } from "./connector-base";
import { redactConnectorText } from "./output-sanitizer";

export type DiagnosticQueryType = "sql" | "promql" | "logql" | "traceql" | "http_get";
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
const SQL_WRITE_PATTERN = /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|copy|call|execute|vacuum|analyze|refresh|lock)\b/i;
const SQL_READ_PREFIX_PATTERN = /^\s*(select|with|show|explain)\b/i;
const DURATION_PARAMETER_PATTERN = /^[1-9]\d{0,5}(ms|s|m|h|d|w)$/;
const SUPPORTED_PARAMETER_TYPES = new Set<DiagnosticQueryParameterType>(["string", "number", "boolean", "date", "duration"]);
const SUPPORTED_SCHEMA_KEYS = new Set(["type", "enum", "default", "required", "min", "max", "maxLength", "pattern"]);

type NormalizedParameterSchema = {
  type: DiagnosticQueryParameterType;
  enum?: DiagnosticQueryParameterValue[];
  default?: DiagnosticQueryParameterValue;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
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

    normalized.pattern = schemaValue.pattern;
  }

  return normalized;
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

function parameterDefault(name: string, schemaValue: unknown): DiagnosticQueryParameterValue | undefined {
  const schema = normalizeParameterSchemaEntry(name, schemaValue);
  if (!schema || !("default" in schema)) {
    return undefined;
  }

  return schema.default;
}

export function assertReadOnlyDiagnosticQuery(queryType: DiagnosticQueryType, renderedQuery: string) {
  const trimmed = renderedQuery.trim();
  if (!trimmed) {
    throw new Error("Diagnostic query rendered to an empty query");
  }

  if (queryType === "sql") {
    if (!SQL_READ_PREFIX_PATTERN.test(trimmed)) {
      throw new Error("SQL diagnostic queries must be read-only SELECT/WITH/SHOW/EXPLAIN statements");
    }

    if (SQL_WRITE_PATTERN.test(trimmed) || trimmed.includes(";")) {
      throw new Error("SQL diagnostic query contains a disallowed write or multi-statement token");
    }
  }
}

export function renderDiagnosticQueryTemplate(definition: DiagnosticQueryDefinition, parameters: DiagnosticQueryParameters): RenderedDiagnosticQuery {
  const referencedParameters = new Set<string>();
  const renderedQuery = definition.template.replace(TEMPLATE_PARAM_PATTERN, (_match, braceName: string | undefined, dollarName: string | undefined) => {
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

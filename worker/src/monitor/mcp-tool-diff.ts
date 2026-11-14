import * as crypto from 'node:crypto';
import type { McpToolChange, McpToolFingerprint } from '../db/schema/types';

export const MCP_NAME_MAX_CHARS = 128;
const PART_CHARS = 10;

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

/** JSON with object keys sorted at every level, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Stored fingerprint: `<sha256 of canonical {name, description, inputSchema}>.<description part>.<schema part>`.
 * The parts are short hashes of the description and schema alone. Only the fingerprint is stored (never
 * the text), so the parts are what lets a later diff say WHICH of the two changed.
 * shortcut: a baseline written without parts reports both reasons; there is no such baseline yet.
 */
export function fingerprintTool(raw: unknown): McpToolFingerprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const tool = raw as Record<string, unknown>;
  if (typeof tool.name !== 'string' || tool.name.length === 0) return null;
  const description =
    typeof tool.description === 'string' ? tool.description : '';
  const inputSchema = tool.inputSchema ?? null;
  const whole = sha256(
    canonicalJson({ name: tool.name, description, inputSchema }),
  );
  return {
    // Stored names reach alerts and logs: keep printable ASCII only (the fingerprint uses the raw name).
    name: tool.name.replace(/[^\x21-\x7e]/g, '?').slice(0, MCP_NAME_MAX_CHARS),
    fingerprint: [
      whole,
      sha256(description).slice(0, PART_CHARS),
      sha256(canonicalJson(inputSchema)).slice(0, PART_CHARS),
    ].join('.'),
  };
}

/** SHA-256 over the sorted `name:fingerprint` pairs: independent of the order the server lists tools in. */
export function hashToolList(tools: McpToolFingerprint[]): string {
  return sha256(
    tools
      .map((tool) => `${tool.name}:${tool.fingerprint}`)
      .sort()
      .join('\n'),
  );
}

export type McpToolDiff = Pick<McpToolChange, 'added' | 'removed' | 'changed'>;

export function diffTools(
  previous: McpToolFingerprint[],
  next: McpToolFingerprint[],
): McpToolDiff {
  const before = new Map(previous.map((tool) => [tool.name, tool.fingerprint]));
  const after = new Map(next.map((tool) => [tool.name, tool.fingerprint]));
  const diff: McpToolDiff = { added: [], removed: [], changed: [] };
  for (const [name, fingerprint] of after) {
    const old = before.get(name);
    if (old === undefined) diff.added.push(name);
    else if (old !== fingerprint) {
      const [, oldDescription, oldSchema] = old.split('.');
      const [, newDescription, newSchema] = fingerprint.split('.');
      const reasons: McpToolDiff['changed'][number]['reasons'] = [];
      const unknown = !oldDescription || !oldSchema;
      if (unknown || oldDescription !== newDescription)
        reasons.push('description');
      if (unknown || oldSchema !== newSchema) reasons.push('schema');
      diff.changed.push({
        name,
        reasons: reasons.length ? reasons : ['description', 'schema'],
      });
    }
  }
  for (const name of before.keys())
    if (!after.has(name)) diff.removed.push(name);
  return diff;
}

export const hasToolChanges = (diff: McpToolDiff) =>
  diff.added.length + diff.removed.length + diff.changed.length > 0;

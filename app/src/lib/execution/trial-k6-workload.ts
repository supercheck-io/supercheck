import { normalizeTargetHostname } from "./target-domain";

export interface TrialK6Workload {
  url: string;
  vus: number;
  durationSeconds: number;
}
const PREFIX = "// supercheck-http-workload: ";

export function normalizeTrialK6Workload(input: unknown): TrialK6Workload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("An HTTP workload is required");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["url", "vus", "durationSeconds"].includes(key)) ||
      typeof value.url !== "string" || value.url.length > 2048 || typeof value.vus !== "number" || !Number.isInteger(value.vus) || value.vus < 1 || value.vus > 5 ||
      typeof value.durationSeconds !== "number" || !Number.isInteger(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 300) {
    throw new Error("Trial HTTP workloads require 1–5 VUs and a duration of 1–300 seconds");
  }
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("Trial HTTP workloads require HTTPS on port 443 without credentials or fragments");
  }
  url.hostname = normalizeTargetHostname(url.hostname);
  return { url: url.toString(), vus: value.vus, durationSeconds: value.durationSeconds };
}

export function createTrialK6Script(input: unknown, hosts?: Record<string, string>): string {
  const workload = normalizeTrialK6Workload(input);
  const options = { vus: workload.vus, duration: `${workload.durationSeconds}s`, maxRedirects: 0, insecureSkipTLSVerify: false, ...(hosts ? { hosts } : {}) };
  return `${PREFIX}${JSON.stringify(workload)}\nimport http from 'k6/http';\nimport { sleep } from 'k6';\nexport const options = ${JSON.stringify(options)};\nexport default function () {\n  http.get(${JSON.stringify(workload.url)}, {"redirects":0,"timeout":"10s"});\n  sleep(1);\n}\n`;
}

export function parseTrialK6Workload(script: string): TrialK6Workload {
  try {
    if (!script.startsWith(PREFIX)) throw new Error();
    const workload = normalizeTrialK6Workload(JSON.parse(script.slice(PREFIX.length, script.indexOf("\n"))));
    if (script !== createTrialK6Script(workload)) throw new Error();
    return workload;
  } catch {
    throw new Error("Trials accept only a generated HTTP workload; arbitrary k6 scripts are not allowed");
  }
}

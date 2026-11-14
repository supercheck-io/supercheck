import { CheckStop, type CheckContext } from "../context";

export const RECORD_TYPES = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2, CAA: 257 } as const;
type RecordType = keyof typeof RECORD_TYPES;

const MAX_ANSWERS = 50;
const MAX_DATA = 512;

export interface DnsRecord {
  name: string;
  ttl: number;
  data: string;
}

/** Tool 6: public DNS data, so private addresses a zone publishes are returned as-is. */
export async function dns(ctx: CheckContext, domain: string) {
  const types = Object.keys(RECORD_TYPES) as RecordType[];
  const answers = await Promise.all(types.map((type) => query(ctx, domain, type)));
  const records: Partial<Record<RecordType, DnsRecord[]>> = {};
  let nxdomain = false;
  let failed = 0;
  let dnssec = false;
  answers.forEach((answer, i) => {
    const type = types[i];
    if (answer.status === 3) nxdomain = true;
    if (answer.status === "error" || (typeof answer.status === "number" && answer.status !== 0 && answer.status !== 3)) failed += 1;
    if (type === "A" && answer.ad) dnssec = true;
    if (answer.records.length) records[type] = answer.records;
  });
  const count = Object.values(records).reduce((sum, list) => sum + (list?.length ?? 0), 0);
  return { domain, resolves: !nxdomain, count, records, dnssec, failedQueries: failed };
}

async function query(
  ctx: CheckContext,
  domain: string,
  type: RecordType,
): Promise<{ status: number | "error"; ad: boolean; records: DnsRecord[] }> {
  try {
    const res = await ctx.fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) return { status: "error", ad: false, records: [] };
    const body = (await res.json()) as {
      Status: number;
      AD?: boolean;
      Answer?: { name: string; type: number; TTL: number; data: string }[];
    };
    const records = (body.Answer ?? [])
      .filter((a) => a.type === RECORD_TYPES[type])
      .slice(0, MAX_ANSWERS)
      .map((a) => ({ name: String(a.name).slice(0, 255), ttl: Number(a.TTL) || 0, data: String(a.data).slice(0, MAX_DATA) }));
    return { status: body.Status, ad: body.AD === true, records };
  } catch (error) {
    if (error instanceof CheckStop) throw error;
    return { status: "error", ad: false, records: [] };
  }
}

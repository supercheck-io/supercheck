/**
 * Runs Polar's webhook endpoint inside a real Better Auth instance, the same
 * plugin wiring and client factory `src/utils/auth.ts` uses, on the in-memory
 * adapter so no database is needed.
 *
 * jest mocks `better-auth` (jose is ESM-only), so a Better Auth or Polar
 * upgrade could break webhook verification or dispatch without any unit test
 * noticing.
 *
 * Run: npx tsx scripts/check-polar-webhooks.ts
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { buildPolarPlugin } from "../src/lib/auth/polar-plugin";
import { createHmac } from "node:crypto";

const SECRET = "polar_whs_check_secret";
const received: string[] = [];

const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "polar-webhook-check-secret-polar-webhook-1",
  database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  plugins: [
    buildPolarPlugin({ accessToken: "polar_oat_check", server: "sandbox", webhookSecret: SECRET }, {
      onCustomerCreated: async (payload) => {
        received.push(`customer.created:${payload.data.external_id}`);
      },
    }),
  ],
});

function customerCreated(): string {
  return JSON.stringify({
    type: "customer.created",
    timestamp: new Date().toISOString(),
    data: {
      id: "cus_check", created_at: new Date().toISOString(), modified_at: null, metadata: {},
      external_id: "org_check", email: "check@example.com", email_verified: true, name: "Check",
      billing_address: null, tax_id: null, organization_id: "po_check", deleted_at: null, avatar_url: "",
    },
  });
}

async function deliver(body: string, signingSecret: string): Promise<Response> {
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  const seconds = Math.floor(timestamp.getTime() / 1000);
  // Standard Webhooks: HMAC-SHA256 over "<id>.<seconds>.<body>", base64, "v1," prefixed.
  const signature = `v1,${createHmac("sha256", signingSecret).update(`${id}.${seconds}.${body}`).digest("base64")}`;
  return auth.handler(
    new Request("http://localhost:3000/api/auth/polar/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(seconds),
        "webhook-signature": signature,
      },
      body,
    }),
  );
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const valid = await deliver(customerCreated(), SECRET);
  expect(valid.status === 200, `a correctly signed webhook must be accepted, got ${valid.status}`);
  expect(
    received.length === 1 && received[0] === "customer.created:org_check",
    `the handler must receive the snake_case SDK fields, saw ${JSON.stringify(received)}`,
  );

  const forged = await deliver(customerCreated(), "not-the-webhook-secret");
  expect(forged.status >= 400 && forged.status < 500, `a forged signature must be rejected, got ${forged.status}`);
  expect(received.length === 1, "a forged webhook must never reach a handler");

  console.log("Polar webhook endpoint check passed");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
  },
);

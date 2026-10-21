import { normalizePolarPayload } from "./polar-payload";

describe("normalizePolarPayload", () => {
  it("adds camelCase aliases for snake_case keys at every depth and keeps the originals", () => {
    const out = normalizePolarPayload({
      data: {
        customer_id: "cus_1",
        product: { id: "p1", is_recurring: true },
        pending_update: { product_id: "p2", applies_at: "2026-11-01T00:00:00Z" },
        prices: [{ price_amount: 5 }],
      },
    });
    expect(out.data).toMatchObject({
      customer_id: "cus_1",
      customerId: "cus_1",
      product: { isRecurring: true, is_recurring: true },
      pendingUpdate: { productId: "p2", appliesAt: "2026-11-01T00:00:00Z" },
      pending_update: { product_id: "p2" },
      prices: [{ priceAmount: 5 }],
    });
  });

  it("leaves camelCase payloads and an existing camelCase value untouched", () => {
    const camel = { data: { customerId: "cus_1", productId: "p1" } };
    expect(normalizePolarPayload(camel)).toEqual(camel);
    expect(
      normalizePolarPayload({ customer_id: "snake", customerId: "camel" }),
    ).toEqual({ customer_id: "snake", customerId: "camel" });
  });

  it("passes merchant metadata through without rewriting its keys", () => {
    const out = normalizePolarPayload({
      data: { metadata: { reference_id: "org_1", referenceId: "org_2" } },
    });
    expect(out.data.metadata).toEqual({
      reference_id: "org_1",
      referenceId: "org_2",
    });
  });

  it("does not mutate its input and keeps non-plain values", () => {
    const date = new Date("2026-10-21T00:00:00Z");
    const input = { data: { starts_at: date } };
    const out = normalizePolarPayload(input);
    expect(input.data).not.toHaveProperty("startsAt");
    expect((out.data as Record<string, unknown>).startsAt).toBe(date);
    expect(normalizePolarPayload(null)).toBeNull();
  });
});

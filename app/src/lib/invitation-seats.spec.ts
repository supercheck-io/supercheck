import { PgDialect } from "drizzle-orm/pg-core";
import { seatReservingInvitations } from "./invitation-seats";

describe("seatReservingInvitations", () => {
  const { sql, params } = new PgDialect().sqlToQuery(seatReservingInvitations("org-1")!);

  it("counts only pending, unexpired invitations of the organization", () => {
    expect(sql).toContain('"invitation"."organization_id" = $1');
    expect(sql).toContain('"invitation"."status" = $2');
    expect(sql).toContain('"invitation"."expires_at" >= $3');
    expect(params.slice(0, 2)).toEqual(["org-1", "pending"]);
  });

  it("excludes invitations addressed to a platform administrator", () => {
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "user" WHERE LOWER\("user"\."email"\) = LOWER\("invitation"\."email"\) AND "user"\."role" = 'super_admin'\)/);
  });
});

import { buildContentDisposition } from "./content-disposition";

describe("buildContentDisposition", () => {
  it("escapes quoted ASCII fallback filenames", () => {
    expect(buildContentDisposition('report"Q1"\\final.csv')).toBe(
      `attachment; filename="report\\"Q1\\"\\\\final.csv"; filename*=UTF-8''report%22Q1%22%5Cfinal.csv`
    );
  });

  it("keeps a UTF-8 filename in filename* while falling back to ASCII", () => {
    expect(buildContentDisposition("résumé.csv")).toBe(
      `attachment; filename="r_sum_.csv"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv`
    );
  });

  it("falls back to a safe default filename when blank", () => {
    expect(buildContentDisposition("   ")).toBe(
      `attachment; filename="file"; filename*=UTF-8''file`
    );
  });

  it("supports inline dispositions", () => {
    expect(buildContentDisposition("status.ics", "inline")).toBe(
      `inline; filename="status.ics"; filename*=UTF-8''status.ics`
    );
  });
});

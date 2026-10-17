import { PRICING_FAQS } from "./pricing-copy";

describe("PRICING_FAQS", () => {
  it("has unique, non-empty questions and answers", () => {
    const questions = PRICING_FAQS.map((faq) => faq.question);
    expect(new Set(questions).size).toBe(questions.length);
    for (const faq of PRICING_FAQS) {
      expect(faq.question.trim()).not.toBe("");
      expect(faq.answer.trim()).not.toBe("");
    }
  });

  it("states three monitoring regions and Europe-only browser and k6 execution", () => {
    const faq = PRICING_FAQS.find(
      (item) => item.question === "Where do Cloud checks run?",
    );
    expect(faq?.answer).toContain(
      "HTTP, SSL, ping, and port monitors can run from Europe, North America, and Asia Pacific",
    );
    expect(faq?.answer).toContain(
      "Browser synthetic monitors, Playwright tests, and k6 load tests run in Europe",
    );
    expect(faq?.answer).not.toContain("planned");
  });

  it("explains why browser checks and k6 tests are Europe-only", () => {
    const faq = PRICING_FAQS.find(
      (item) => item.question === "Why do browser checks and k6 tests run only in Europe?",
    );
    expect(faq?.answer).toContain("available in Europe only");
    expect(faq?.answer).toContain("each location counts separately");
  });

  it("counts locations toward browser minutes only when browser checks are enabled in more", () => {
    const faq = PRICING_FAQS.find((item) =>
      item.question.startsWith("How are browser execution minutes measured"),
    );
    expect(faq?.answer).toContain("if browser checks are enabled in more locations");
    expect(faq?.answer).toContain("from any location do not consume Playwright minutes");
  });
});

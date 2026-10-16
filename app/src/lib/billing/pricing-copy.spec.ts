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

  it("describes current coverage without advertising planned regions as available", () => {
    const faq = PRICING_FAQS.find(
      (item) => item.question === "Where do Cloud checks run?",
    );
    expect(faq?.answer).toContain("Supercheck Cloud currently runs");
    expect(faq?.answer).toContain("US and Singapore monitoring regions are planned");
    expect(faq?.answer).toContain(
      "browser synthetic checks, Playwright tests, and k6 execution in EU",
    );
  });

  it("counts locations toward browser minutes only when browser checks are enabled in more", () => {
    const faq = PRICING_FAQS.find((item) =>
      item.question.startsWith("How are browser execution minutes measured"),
    );
    expect(faq?.answer).toContain("if browser checks are enabled in more locations");
  });
});

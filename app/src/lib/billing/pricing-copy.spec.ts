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

  it("states the single EU launch location", () => {
    const faq = PRICING_FAQS.find(
      (item) => item.question === "Where do Cloud checks run?",
    );
    expect(faq?.answer).toContain("one EU monitoring location");
  });

  it("counts locations toward browser minutes only when more are enabled", () => {
    const faq = PRICING_FAQS.find((item) =>
      item.question.startsWith("How are browser execution minutes measured"),
    );
    expect(faq?.answer).toContain("if more locations are enabled");
  });
});

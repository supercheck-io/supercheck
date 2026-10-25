import catalog from "./plan-catalog.json";
import { fillTrialText, trialFaqs, trialHighlights, trialValues } from "./trial-copy";

describe("trial copy", () => {
  it("fills every placeholder in the catalog FAQs from the catalog limits", () => {
    const faqs = trialFaqs();
    expect(faqs).toHaveLength(catalog.trial.faqs.length);
    for (const faq of faqs) expect(`${faq.question} ${faq.answer}`).not.toMatch(/[{}]/);
    const first = faqs[0].answer;
    const { limits, durationDays } = catalog.trial;
    expect(first).toContain(`${durationDays}-day free trial`);
    expect(first).toContain("Eligible new Cloud accounts get one");
    expect(first).not.toContain("Every new Cloud organization");
    expect(first).toContain(`${limits.playwrightMinutes} browser minutes`);
    expect(first).toContain(`${limits.k6VuMinutes} virtual-user minutes`);
    expect(first).toContain(`${limits.k6MaxDurationSeconds / 60} minutes per run`);
  });

  it("refuses a placeholder that does not exist instead of printing a blank", () => {
    expect(() => fillTrialText("up to {nonsense} things")).toThrow("{nonsense}");
  });

  it("lists the same limits in the highlights", () => {
    const text = trialHighlights().join(" | ");
    const v = trialValues();
    for (const needle of [v.maxMonitors, v.maxStatusPages, v.playwrightMinutes, v.k6VuMinutes, v.sreInvestigations, v.aiCredits]) {
      expect(text).toContain(String(needle));
    }
  });

  it("says what happens at the end of the trial", () => {
    const text = trialFaqs().map((faq) => faq.answer).join(" ");
    expect(text).toContain("Nothing is deleted");
    expect(text).toContain("paused");
  });
});

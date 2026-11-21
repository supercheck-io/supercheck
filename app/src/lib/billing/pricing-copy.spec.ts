import catalog from "./plan-catalog.json";
import { PRICING_FAQS, SHARED_PRICING_FAQS, planFeatureList } from "./pricing-copy";

describe("planFeatureList", () => {
  it("gives Pro the extra-seat hint and Plus a plain members line", () => {
    const plus = planFeatureList("plus", catalog.plus.limits);
    const pro = planFeatureList("pro", catalog.pro.limits);
    expect(plus).toContain(`${catalog.plus.limits.maxTeamMembers} team members, ${catalog.plus.limits.maxProjects} projects`);
    expect(pro).toContainEqual(expect.objectContaining({ hint: expect.stringContaining("per extra member") }));
    expect(plus).toContainEqual(expect.objectContaining({ text: "$70 default overage cap" }));
    expect(plus.at(-1)).toBe("Email support");
    expect(pro.at(-1)).toBe("Priority email support");
    expect(planFeatureList("plus", catalog.plus.limits, "$0.01/min Playwright")).toContainEqual(
      expect.objectContaining({ hint: expect.stringContaining("Overage: $0.01/min Playwright") }),
    );
  });
});

describe("PRICING_FAQS", () => {
  it("has unique, non-empty questions and answers", () => {
    const questions = PRICING_FAQS.map((faq) => faq.question);
    expect(new Set(questions).size).toBe(questions.length);
    for (const faq of PRICING_FAQS) {
      expect(faq.question.trim()).not.toBe("");
      expect(faq.answer.trim()).not.toBe("");
    }
  });

  it("carries the trial questions from the shared catalog, once", () => {
    const questions = PRICING_FAQS.map((faq) => faq.question);
    expect(questions).toEqual(expect.arrayContaining(["Is there a free trial?", "What happens when the free trial ends?"]));
    expect(questions.filter((question) => question === "Is there a free trial?")).toHaveLength(1);
    expect(questions.some((question) => /self-host/i.test(question))).toBe(false);
  });

  it("says a plan that ends pauses resources, keeps them, and deletes check details past the no-plan window", () => {
    const answer = PRICING_FAQS.find((faq) => faq.question === "What happens if I cancel?")?.answer;
    expect(answer).toContain("end of the period you paid for");
    expect(answer).toContain("tests, jobs, monitors, and status pages are kept");
    expect(answer).toContain(`Check details older than ${catalog.trial.retention.dataRetentionDays} days are deleted`);
    expect(answer).not.toContain("Nothing is deleted");
  });

  it("explains check history retention with the catalog's windows, including the daily uptime floor", () => {
    const answer = SHARED_PRICING_FAQS.find((faq) => faq.question === "How long is check history kept?")?.answer ?? "";
    expect(answer).toContain(`${catalog.plus.limits.dataRetentionDays} days on Plus and ${catalog.pro.limits.dataRetentionDays} days on Pro`);
    expect(answer).toContain(`${catalog.plus.limits.aggregatedDataRetentionDays} days on Plus and ${catalog.pro.limits.aggregatedDataRetentionDays} days on Pro`);
    expect(answer).toContain(`at least ${catalog.minDailyAggregateRetentionDays} days on every plan`);
    expect(answer).toContain("deleted automatically");
  });

  it("states three monitoring regions and Europe-only browser and k6 execution", () => {
    const faq = PRICING_FAQS.find(
      (item) => item.question === "Where do Cloud checks run?",
    );
    expect(faq?.answer).toContain(
      "HTTP, SSL, ping, port, and MCP monitors can run from Europe, North America, and Asia Pacific",
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

  it("states the default overage caps and what pauses at the cap", () => {
    const control = PRICING_FAQS.find((item) => item.question === "How can I control overage spending?")?.answer;
    expect(control).toContain("\$70 on Plus and \$300 on Pro");
    expect(control).toContain("about $99 on Plus or $399 on Pro at most");
    expect(control).toContain("turning off the hard stop allows more overage");
    const paused = PRICING_FAQS.find((item) => item.question === "What pauses when I reach my overage cap?")?.answer;
    expect(paused).toContain("k6 load tests");
    expect(paused).toContain("HTTP, website, ping, port, and MCP monitors keep running");
  });
});

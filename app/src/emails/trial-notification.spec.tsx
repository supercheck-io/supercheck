/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import {
  TrialNotificationEmail,
  trialNotificationSubject,
  type TrialNotificationKind,
} from "./trial-notification";

const base = {
  organizationName: "Acme",
  daysRemaining: 7,
  subscribeUrl: "https://app.supercheck.io/subscribe",
};
const html = (kind: TrialNotificationKind, daysRemaining = 7) =>
  renderToStaticMarkup(
    TrialNotificationEmail({ ...base, kind, daysRemaining, browserMinutes: 1000 }),
  );

describe("TrialNotificationEmail", () => {
  it("tells a halfway user how many days remain and links to subscribe", () => {
    const markup = html("midway", 7);
    expect(markup).toContain("7 days left in your free trial");
    expect(markup).toContain('href="https://app.supercheck.io/subscribe"');
    expect(markup).toContain("Acme");
  });

  it("warns on the last day that monitors will pause but nothing is deleted", () => {
    const markup = html("ending", 1);
    expect(markup).toContain("ends within a day");
    expect(markup).toContain("paused");
    expect(markup).toContain("Nothing is deleted");
  });

  it("tells an ended trial what happened and how to restore it", () => {
    const markup = html("ended", 0);
    expect(markup).toContain("Your free trial has ended");
    expect(markup).toContain(
      "monitors are paused and your status pages are archived",
    );
    expect(markup).toContain("Nothing was deleted");
    expect(markup).toContain("Restore my setup");
  });

  it("tells a 50% browser-minute user what is used and links to subscribe", () => {
    const markup = html("browserHalf");
    expect(markup).toContain("used 50% of your trial browser minutes");
    expect(markup).toContain("1,000 browser minutes");
    expect(markup).toContain('href="https://app.supercheck.io/subscribe"');
  });

  it("tells a 100% browser-minute user that browser checks stopped and links to subscribe", () => {
    const markup = html("browserFull");
    expect(markup).toContain("used 100% of your trial browser minutes");
    expect(markup).toContain("no longer run");
    expect(markup).toContain('href="https://app.supercheck.io/subscribe"');
  });

  it("does not use fear-based or countdown pressure copy", () => {
    for (const kind of ["midway", "ending", "ended", "browserHalf", "browserFull"] as const) {
      expect(html(kind).toLowerCase()).not.toMatch(
        /last chance|act now|hurry|don't miss/,
      );
    }
  });

  it.each([
    ["midway", "[Supercheck] Your trial is halfway through: Acme"],
    ["ending", "[Supercheck] Your trial ends tomorrow: Acme"],
    ["ended", "[Supercheck] Your trial has ended: Acme"],
    ["browserHalf", "[Supercheck] Half of your trial browser minutes are used: Acme"],
    ["browserFull", "[Supercheck] Your trial browser minutes are used up: Acme"],
  ] as const)("uses a clear %s subject", (kind, subject) => {
    expect(trialNotificationSubject(kind, "Acme", 5, 1000)).toBe(subject);
  });
});

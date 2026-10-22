import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TrialBanner,
  trialBannerMessage,
  TRIAL_ENDING_SOON_DAYS,
} from "./trial-banner";

function renderBanner(
  initialTrial: Parameters<typeof TrialBanner>[0]["initialTrial"],
) {
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ isActive: false, plan: null, trial: initialTrial }),
    }) as unknown as typeof fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrialBanner initialTrial={initialTrial} />
    </QueryClientProvider>,
  );
}

const trial = (daysRemaining: number, active = true) => ({
  active,
  expiresAt: "2026-11-15T00:00:00.000Z",
  daysRemaining,
});

describe("trialBannerMessage", () => {
  it("counts the days left", () => {
    expect(trialBannerMessage(trial(9))).toBe(
      "Your free trial has 9 days left.",
    );
  });

  it("says the trial ends today on the last day", () => {
    expect(trialBannerMessage(trial(1))).toBe("Your free trial ends today.");
  });
});

describe("TrialBanner", () => {
  it("shows the remaining days with a way to choose a plan", () => {
    renderBanner(trial(9));
    expect(screen.getByRole("status")).toHaveTextContent("9 days left");
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute(
      "href",
      "/subscribe",
    );
  });

  it("explains what continues after subscribing", () => {
    renderBanner(trial(9));
    expect(screen.getByRole("status")).toHaveTextContent(
      "monitors and status pages",
    );
  });

  it("emphasises the final days", () => {
    renderBanner(trial(TRIAL_ENDING_SOON_DAYS));
    expect(screen.getByRole("status").className).toContain("amber");
    renderBanner(trial(10));
  });

  it("shows nothing without a trial or after it ended", () => {
    const { container, unmount } = renderBanner(null);
    expect(container).toBeEmptyDOMElement();
    unmount();
    const ended = renderBanner(trial(0, false));
    expect(ended.container).toBeEmptyDOMElement();
  });
});

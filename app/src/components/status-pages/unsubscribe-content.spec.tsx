import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnsubscribeContent } from "./unsubscribe-content";
import { getSubscriberByToken } from "@/actions/unsubscribe-from-status-page";
import { getTranslations } from "@/lib/status-page-translations";

jest.mock("@/actions/unsubscribe-from-status-page", () => ({
  getSubscriberByToken: jest.fn(),
  unsubscribeFromStatusPage: jest.fn(),
}));

const t = getTranslations("en");
const lookup = getSubscriberByToken as jest.Mock;

it("shows a retryable message, not an invalid link, when the lookup is rate limited", async () => {
  lookup
    .mockResolvedValueOnce({ success: false, subscriber: null, rateLimited: true, retryAfter: 600 })
    .mockResolvedValueOnce({ success: false, subscriber: null });

  render(<UnsubscribeContent token="tok" />);

  expect(await screen.findByText(t.unsubscribeError)).toBeInTheDocument();
  expect(screen.queryByText(t.invalidUnsubscribeLink)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: t.unsubscribe }));

  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(t.invalidUnsubscribeLink)).toBeInTheDocument();
});

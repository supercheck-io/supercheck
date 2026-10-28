import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { unpublishStatusPage } from "@/actions/publish-status-page";
import type { StatusPageMonitor } from "@/hooks/use-status-pages";

import { StatusPageDetail } from "./status-page-detail";

jest.mock("@/actions/publish-status-page", () => ({
  publishStatusPage: jest.fn(),
  unpublishStatusPage: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

const statusPage = {
  id: "5d6f6b1a-8bde-4f0f-9a0e-1a2b3c4d5e6f",
  name: "Checkout Status",
  subdomain: "checkout",
  status: "published",
  pageDescription: "Current checkout health.",
  headline: null,
  supportUrl: null,
  timezone: "UTC",
  allowPageSubscribers: true,
  allowEmailSubscribers: true,
  allowWebhookSubscribers: false,
  allowIncidentSubscribers: true,
  allowSlackSubscribers: false,
  allowRssFeed: false,
  notificationsFromEmail: null,
  notificationsEmailFooter: null,
  customDomain: null,
  customDomainVerified: null,
  language: "en",
  cssBodyBackgroundColor: null,
  cssFontColor: null,
  cssGreens: null,
  cssYellows: null,
  cssOranges: null,
  cssBlues: null,
  cssReds: null,
  faviconLogo: null,
  transactionalLogo: null,
  createdAt: null,
  updatedAt: null,
};

const monitors: StatusPageMonitor[] = [];

function renderDetail(overrides: { canUpdate?: boolean; onDataChange?: () => void } = {}) {
  return render(
    <StatusPageDetail
      statusPage={statusPage}
      statusPageDomain="example.com"
      monitors={monitors}
      components={[]}
      canUpdate={overrides.canUpdate ?? true}
      onDataChange={overrides.onDataChange}
    />,
  );
}

beforeEach(() => {
  jest.mocked(unpublishStatusPage).mockReset();
});

describe("StatusPageDetail destructive actions", () => {
  it("keeps the page published when the unpublish confirmation is cancelled", () => {
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: 'Unpublish "Checkout Status"?' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(unpublishStatusPage).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("unpublishes only after the confirmation is accepted", async () => {
    jest.mocked(unpublishStatusPage).mockResolvedValue({
      success: true,
      message: "Status page unpublished successfully",
      statusPage: {
        id: statusPage.id,
        name: statusPage.name,
        subdomain: statusPage.subdomain,
        status: "draft",
      },
    });
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish page" }));

    await waitFor(() =>
      expect(unpublishStatusPage).toHaveBeenCalledWith(statusPage.id, false),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("archives only after the confirmation is accepted", async () => {
    jest.mocked(unpublishStatusPage).mockResolvedValue({
      success: true,
      message: "Status page unpublished successfully",
      statusPage: {
        id: statusPage.id,
        name: statusPage.name,
        subdomain: statusPage.subdomain,
        status: "archived",
      },
    });
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(
      screen.getByRole("heading", { name: 'Archive "Checkout Status"?' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive page" }));

    await waitFor(() =>
      expect(unpublishStatusPage).toHaveBeenCalledWith(statusPage.id, true),
    );
  });

  it("disables both dialog actions while the request is in flight", async () => {
    jest.mocked(unpublishStatusPage).mockReturnValue(new Promise(() => {}));
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish page" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Unpublish page" }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("cannot confirm without update permission", () => {
    renderDetail({ canUpdate: false });

    const trigger = screen.getByRole("button", { name: "Unpublish" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute(
      "title",
      "You don't have permission to unpublish",
    );

    fireEvent.click(trigger);

    const archive = screen.getByRole("button", { name: "Archive" });
    expect(archive).toBeDisabled();
    expect(archive).toHaveAttribute(
      "title",
      "You don't have permission to archive",
    );
    fireEvent.click(archive);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(unpublishStatusPage).not.toHaveBeenCalled();
  });
});

describe("StatusPageDetail cache refresh", () => {
  it("refreshes the status query after unpublishing", async () => {
    jest.mocked(unpublishStatusPage).mockResolvedValue({
      success: true,
      message: "ok",
      statusPage: { id: statusPage.id, name: statusPage.name, subdomain: statusPage.subdomain, status: "draft" },
    });
    const onDataChange = jest.fn();
    renderDetail({ onDataChange });

    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish page" }));

    await waitFor(() => expect(onDataChange).toHaveBeenCalled());
  });
});

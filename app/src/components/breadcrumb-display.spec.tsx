import { render, screen } from "@testing-library/react";

import { BreadcrumbProvider, Breadcrumbs } from "@/components/breadcrumb-context";
import { BreadcrumbDisplay } from "./breadcrumb-display";

function renderBreadcrumbs(
  items: Array<{ label: string; href?: string; isCurrentPage?: boolean }>,
) {
  return render(
    <BreadcrumbProvider>
      <Breadcrumbs items={items} />
      <header className="flex h-14 min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 overflow-hidden">
          <BreadcrumbDisplay />
        </div>
      </header>
    </BreadcrumbProvider>,
  );
}

describe("BreadcrumbDisplay narrow-viewport contract", () => {
  it("keeps the trail on one truncated line instead of wrapping the header", async () => {
    renderBreadcrumbs([
      { label: "Home", href: "/" },
      { label: "Status Pages", href: "/status-pages" },
      {
        label: "checkout-platform-production-status-page",
        isCurrentPage: true,
      },
    ]);

    const list = await screen.findByRole("list");
    expect(list).toHaveClass("flex-nowrap", "min-w-0", "overflow-hidden");

    const currentPage = screen.getByText(
      "checkout-platform-production-status-page",
    );
    expect(currentPage).toHaveClass("truncate", "min-w-0");
    expect(currentPage).toHaveAttribute(
      "title",
      "checkout-platform-production-status-page",
    );
    expect(
      screen.getByRole("link", { name: "Status Pages" }),
    ).toHaveClass("truncate", "min-w-0");
  });

  it("keeps the Home icon fixed so it never collapses to zero width", async () => {
    renderBreadcrumbs([
      { label: "Home", href: "/" },
      { label: "Status Pages", href: "/status-pages" },
    ]);

    const list = await screen.findByRole("list");
    const homeItem = list.firstElementChild;

    expect(homeItem).toHaveClass("shrink-0");
    expect(homeItem).not.toHaveClass("flex-1");
  });
});

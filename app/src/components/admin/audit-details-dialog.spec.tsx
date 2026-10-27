import { fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuditDetailsDialog } from "./audit-details-dialog";

const log = {
  id: "018f0000-0000-7000-8000-000000000001",
  action: "user_login",
  createdAt: "2026-06-28T10:00:00.000Z",
  user: { id: "u1", name: "Ada Admin", email: "ada@example.com" },
  details: {
    success: true,
    resource: "session",
    ipAddress: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    extra: "raw-only-value",
  },
};

function open() {
  render(
    <TooltipProvider>
      <AuditDetailsDialog log={log} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /view details/i }));
}

it("shows the key fields and keeps raw JSON collapsed by default", () => {
  open();
  expect(screen.getByText("Ada Admin")).toBeInTheDocument();
  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
  expect(screen.getByText("Success")).toBeInTheDocument();
  expect(screen.queryByText(/raw-only-value/)).not.toBeInTheDocument();
});

it("reveals the full event JSON on demand", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: /event details/i }));
  expect(screen.getByText(/raw-only-value/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /copy json/i })).toBeInTheDocument();
});

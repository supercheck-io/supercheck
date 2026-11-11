import { render } from "@testing-library/react";
import { Sparkles } from "lucide-react";

import { IconChip } from "./icon-chip";

it("renders a small decorative chip by default with the tone's token classes", () => {
  const { container } = render(<IconChip icon={Sparkles} tone="ai" />);
  const chip = container.firstElementChild!;

  expect(chip).toHaveAttribute("aria-hidden", "true");
  expect(chip).toHaveAttribute("data-tone", "ai");
  expect(chip).toHaveClass("size-6", "bg-ai/10", "text-ai");
});

it("renders the page-title size", () => {
  const { container } = render(<IconChip icon={Sparkles} tone="monitor" size="md" />);

  expect(container.firstElementChild).toHaveClass("size-8", "rounded-lg", "text-monitor");
});

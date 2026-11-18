import { fireEvent, render, screen } from "@testing-library/react";
import { Lightbulb } from "lucide-react";

import { SectionTitle } from "./incident-ui";

it("opens the section hint as an info popover titled with the heading", () => {
  render(
    <SectionTitle icon={Lightbulb} tone="amber" hint="Newest first.">
      Hypotheses
    </SectionTitle>,
  );
  expect(screen.queryByText("Newest first.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "About hypotheses" }));
  expect(screen.getByRole("heading", { name: "Hypotheses", level: 4 })).toBeInTheDocument();
  expect(screen.getByText("Newest first.")).toBeInTheDocument();
});

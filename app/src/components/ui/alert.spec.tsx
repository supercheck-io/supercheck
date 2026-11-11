import { render, screen } from "@testing-library/react";

import { Alert, AlertDescription } from "./alert";

it.each([
  ["info", "bg-blue-500/10"],
  ["success", "bg-success/10"],
  ["warning", "bg-warning/10"],
  ["error", "bg-failure/10"],
] as const)("renders the %s callout on tokens", (variant, tint) => {
  render(
    <Alert variant={variant}>
      <AlertDescription>Message</AlertDescription>
    </Alert>,
  );
  expect(screen.getByRole("alert")).toHaveClass(tint, "text-foreground");
});

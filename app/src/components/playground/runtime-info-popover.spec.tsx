import { fireEvent, render, screen } from "@testing-library/react";
import RuntimeInfoPopover from "./runtime-info-popover";

it.each([
  ["browser", "Playwright", "path / node:path", /Validation checks syntax and test compatibility/, /readFile\(\) for file variables/],
  ["performance", "k6", "k6/net/grpc", /Node.js packages and k6\/browser are unsupported/, /open\(getFile\(\)\) in init context/],
] as const)("shows %s guidance and modules only after the info button is clicked", (testType, runtime, module, restrictions, files) => {
  render(<RuntimeInfoPopover testType={testType} />);
  expect(screen.queryByText(module)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Available runtime libraries" }));
  expect(screen.getByRole("heading", { name: `${runtime} Runtime Modules` })).toBeInTheDocument();
  expect(screen.getByText(module)).toBeInTheDocument();
  expect(screen.getByText(restrictions)).toBeInTheDocument();
  expect(screen.getByText(files)).toBeInTheDocument();
  expect(screen.queryByText(/deployment-configurable|Default test timeout/)).not.toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("dialog", { name: "Available runtime libraries" }), { key: "Escape" });
  expect(screen.queryByText(module)).not.toBeInTheDocument();
});

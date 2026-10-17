import { fireEvent, render, screen } from "@testing-library/react";
import RuntimeInfoPopover from "./runtime-info-popover";

it.each([
  ["browser", "Playwright", "path / node:path", /direct filesystem and process access is blocked/, /readFile\(\) for file variables/],
  ["performance", "k6", "k6/net/grpc", /Node.js packages and k6\/browser are unsupported/, /open\(getFile\(\)\) in init context/],
] as const)("shows %s guidance on demand without closing the module list", (testType, runtime, module, restrictions, files) => {
  render(<RuntimeInfoPopover testType={testType} />);
  fireEvent.click(screen.getByRole("button", { name: "Available runtime libraries" }));
  expect(screen.getByText(module)).toBeInTheDocument();
  expect(screen.queryByText(/Scripts are checked for security/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: `${runtime} Runtime Modules guidance` }));
  expect(screen.getByText(restrictions)).toBeInTheDocument();
  expect(screen.getByText(files)).toBeInTheDocument();
  expect(screen.queryByText(/deployment-configurable|Default test timeout/)).not.toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("dialog", { name: `${runtime} Runtime Modules guidance` }), { key: "Escape" });
  expect(screen.queryByText(/Scripts are checked for security/)).not.toBeInTheDocument();
  expect(screen.getByText(module)).toBeInTheDocument();
});

import { fireEvent, render, screen } from "@testing-library/react";
import StatusPagePage from "./page";

const push = jest.fn();
const useDetailMock = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "sp1" }),
  useRouter: () => ({ push }),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/hooks/use-status-pages", () => ({ useStatusPageDetail: () => useDetailMock() }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
jest.mock("@/components/status-pages/status-page-detail", () => ({ StatusPageDetail: () => null }));

const base = { statusPage: undefined, components: [], monitors: [], isLoading: false, isRestoring: false, invalidate: jest.fn() };

beforeEach(() => jest.clearAllMocks());

it("does not claim the page was deleted on a transient error, and offers Retry", () => {
  const invalidate = jest.fn();
  useDetailMock.mockReturnValue({ ...base, invalidate, error: Object.assign(new Error("boom"), { status: 500 }) });
  render(<StatusPagePage />);
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(invalidate).toHaveBeenCalled();
});

it("redirects to the list when the page does not exist", () => {
  useDetailMock.mockReturnValue({ ...base, error: Object.assign(new Error("Not found"), { status: 404 }) });
  render(<StatusPagePage />);
  expect(push).toHaveBeenCalledWith("/status-pages");
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SetupDraft } from "@/lib/setup/draft-schema";
import { makeResponse, makeStepProps, PROJECT_ID } from "../test-fixtures";
import { AiSreStep } from "./ai-sre-step";
import { AlertsStep } from "./alerts-step";

const OTHER = "33333333-3333-4333-8333-333333333333";
const proj = (id: string, name: string) => ({ id, name, organizationId: "org-1", isDefault: false, userRole: "project_admin" });
jest.mock("@/hooks/use-project-context", () => ({ useProjectContextSafe: () => ({ projects: [proj(PROJECT_ID, "Web"), proj(OTHER, "Prod")] }) }));
jest.mock("@/actions/sre-connectors", () => ({ createSreConnector: jest.fn(), validateSreConnector: jest.fn() }));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const ID1 = "00000000-0000-4000-8000-0000000000a1";
const ID2 = "00000000-0000-4000-8000-0000000000a2";

function drafting(initial: SetupDraft = {}) {
  let draft = initial;
  return { patchDraft: jest.fn((fn: (d: SetupDraft) => SetupDraft) => void (draft = fn(draft))), get: () => draft };
}
const copyAll = (noun: string) => {
  fireEvent.keyDown(screen.getByLabelText("Project"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "Prod" }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Copy all ${noun} from Prod`) }));
};

describe("copy from project wiring", () => {
  it("adds copied alert channels to draft.alerts.providerIds without duplicates", async () => {
    global.fetch = ((url: string) =>
      url === "/api/notification-providers" ? json([]) : json({ providers: [{ sourceId: "a", id: ID1, status: "copied" }, { sourceId: "b", id: ID1, status: "adopted" }], connectors: [] })) as unknown as typeof fetch;
    const d = drafting({ alerts: { providerIds: [ID2] } });
    render(<AlertsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    copyAll("alert channels");
    await waitFor(() => expect(d.get().alerts?.providerIds).toEqual([ID2, ID1]));
  });

  it("does not offer the copy on Alerts without notification:create", () => {
    const response = makeResponse();
    render(<AlertsStep {...makeStepProps({ permissions: { ...response.permissions, canCreateNotification: false } })} />);
    expect(screen.queryByTestId("setup-copy-providers")).toBeNull();
  });

  it("adds copied connectors to draft.aiSre.connectorIds", async () => {
    global.fetch = (() => json({ providers: [], connectors: [{ sourceId: "a", id: ID1, status: "copied" }] })) as unknown as typeof fetch;
    const d = drafting();
    const response = makeResponse();
    render(<AiSreStep {...makeStepProps({ permissions: { ...response.permissions, canConfigureConnectors: true }, patchDraft: d.patchDraft, draft: d.get() })} />);
    copyAll("connectors");
    await waitFor(() => expect(d.get().aiSre?.connectorIds).toEqual([ID1]));
  });
});

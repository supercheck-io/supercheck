import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createWrapper } from "./test-wrapper";
import { Welcome } from "./welcome";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock } };

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  toast.error.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe("Welcome", () => {
  it("renders the four personas as a radio group and keeps Start setup off until one is picked", () => {
    const { Wrapper } = createWrapper();
    render(<Welcome mode="creator" projectName="Web App" onDone={jest.fn()} />, { wrapper: Wrapper });
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.id)).toEqual(["persona-sre", "persona-qa", "persona-developer", "persona-leader"]);
    expect(screen.getByText("Keep production up")).toBeTruthy();
    expect(screen.getByText("Let's set up Web App. What will you mostly do here?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start setup/ })).toBeDisabled();
  });

  it("saves the picked persona and continues", async () => {
    respond({ persona: "qa", seen: true });
    const onDone = jest.fn();
    const { Wrapper, client } = createWrapper();
    render(<Welcome mode="creator" projectName="Web App" onDone={onDone} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("radio", { name: /Test my app/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start setup/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ persona: "qa" });
    expect(client.getQueryData(["user-preferences"])).toEqual({ persona: "qa", seen: true });
  });

  it("Skip saves no persona", async () => {
    respond({ persona: null, seen: true });
    const onDone = jest.fn();
    const { Wrapper } = createWrapper();
    render(<Welcome mode="creator" projectName="Web App" onDone={onDone} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ persona: null });
  });

  it("asks invited members the persona question only", async () => {
    respond({ persona: "sre", seen: true });
    const onDone = jest.fn();
    const { Wrapper } = createWrapper();
    render(<Welcome mode="member" projectName="Web App" organizationName="Acme" onDone={onDone} />, { wrapper: Wrapper });
    expect(screen.getByText("You joined Acme. What will you mostly do here?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start setup/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Keep production up/ }));
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("change mode preselects the saved persona, saves a new one and cancels without saving", async () => {
    respond({ persona: "qa", seen: true });
    const onDone = jest.fn();
    const { Wrapper } = createWrapper();
    render(<Welcome mode="change" initialPersona="sre" projectName="Web App" onDone={onDone} />, { wrapper: Wrapper });
    expect(screen.getByText("Change your persona")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Keep production up/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Test my app/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ persona: "qa" });
    // "No preference" clears a saved persona.
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "No preference" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ persona: null });
    onDone.mockClear();
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic organization name and tells the user when saving fails", async () => {
    respond({ error: "nope" }, 500);
    const onDone = jest.fn();
    const { Wrapper } = createWrapper();
    render(<Welcome mode="member" projectName="Web App" onDone={onDone} />, { wrapper: Wrapper });
    expect(screen.getByText(/You joined the organization/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save your choice. Try again."));
    expect(onDone).not.toHaveBeenCalled();
  });
});

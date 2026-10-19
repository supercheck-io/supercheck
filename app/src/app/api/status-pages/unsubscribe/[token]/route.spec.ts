/** @jest-environment node */
jest.mock("@/actions/unsubscribe-from-status-page", () => ({
  unsubscribeFromStatusPage: jest.fn(),
}));
import { unsubscribeFromStatusPage } from "@/actions/unsubscribe-from-status-page";
import { POST } from "./route";

const token = "a".repeat(64);
const call = (body: BodyInit | null, headers: Record<string, string>) =>
  POST(new Request("http://localhost/x", { method: "POST", body, headers }), {
    params: Promise.resolve({ token }),
  });

describe("one-click unsubscribe (RFC 8058)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (unsubscribeFromStatusPage as jest.Mock).mockResolvedValue({ success: true });
  });

  it("accepts the urlencoded form, including a trailing newline", async () => {
    const res = await call("List-Unsubscribe=One-Click\r\n", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(200);
    expect(unsubscribeFromStatusPage).toHaveBeenCalledWith(token);
  });

  it("accepts a multipart form", async () => {
    const form = new FormData();
    form.set("List-Unsubscribe", "One-Click");
    expect((await call(form, {})).status).toBe(200);
  });

  it("rejects other bodies without unsubscribing", async () => {
    const res = await call("List-Unsubscribe=Nope", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(400);
    expect(unsubscribeFromStatusPage).not.toHaveBeenCalled();
  });
});

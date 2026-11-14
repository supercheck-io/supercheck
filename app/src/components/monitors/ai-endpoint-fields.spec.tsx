import { render, screen, fireEvent } from "@testing-library/react";
import { addAiEndpointIssues, buildAiEndpointConfig, monthlyCalls } from "./ai-endpoint-fields";
import { SecretPicker } from "./secret-picker";

let hookState: { data?: string[]; isLoading: boolean; isError: boolean; error?: Error; isFetching: boolean; refetch: jest.Mock };
jest.mock("@/hooks/use-project-secrets", () => ({ useProjectSecretNames: () => hookState }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, ...rest }: { children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...rest}>{children}</a> }));

const base = { name: "n", type: "http_request", interval: "300" };

describe("monthlyCalls", () => {
  it("counts calls from interval and locations", () => {
    expect(monthlyCalls(300, 1)).toBe(8640);
    expect(monthlyCalls(300, 3)).toBe(25920);
    expect(monthlyCalls(0, 1)).toBe(0);
    expect(monthlyCalls(300, 0)).toBe(8640);
  });
});

describe("buildAiEndpointConfig", () => {
  it("builds the preset config and leaves empty optional fields out", () => {
    expect(
      buildAiEndpointConfig({ ...base, aiConfig_model: " gpt-4o-mini ", aiConfig_secretKey: "OPENAI_KEY", aiConfig_keyHeader: "", aiConfig_prompt: "", aiConfig_maxTokens: "", aiConfig_timeoutSeconds: "" }),
    ).toEqual({ aiEndpoint: { model: "gpt-4o-mini", secretKey: "OPENAI_KEY" }, timeoutSeconds: 60 });
  });
  it("sends no key fields when No key is ticked, and carries numeric limits", () => {
    expect(
      buildAiEndpointConfig({ ...base, aiConfig_model: "m", aiConfig_noKey: true, aiConfig_secretKey: "STALE", aiConfig_keyHeader: "x-api-key", aiConfig_maxTokens: "32", aiConfig_firstTokenTimeoutSeconds: "8", aiConfig_expectText: "ok", aiConfig_prompt: "Say hi", aiConfig_timeoutSeconds: "30" }),
    ).toEqual({ aiEndpoint: { model: "m", prompt: "Say hi", maxTokens: 32, expectText: "ok", firstTokenTimeoutMs: 8000 }, timeoutSeconds: 30 });
  });
});

describe("SecretPicker", () => {
  const props = { projectId: "p1", value: undefined, onChange: jest.fn(), testId: "pick", label: "Key secret" };
  const state = (over: Partial<typeof hookState>) => (hookState = { isLoading: false, isError: false, isFetching: false, refetch: jest.fn(), ...over });

  it("shows loading, error with retry, and empty states", () => {
    state({ isLoading: true });
    const { rerender } = render(<SecretPicker {...props} />);
    expect(screen.getByTestId("pick-loading")).toBeInTheDocument();
    const s = state({ isError: true, error: new Error("boom") });
    rerender(<SecretPicker {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(s.refetch).toHaveBeenCalled();
    state({ data: [] });
    rerender(<SecretPicker {...props} />);
    expect(screen.getByTestId("pick-empty")).toHaveTextContent("No secrets in this project yet.");
    const link = screen.getByRole("link", { name: "Add a secret" });
    expect(link).toHaveAttribute("href", "/variables");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a labelled picker, keeping a stored name that no longer exists visible", () => {
    state({ data: ["A_KEY"] });
    render(<SecretPicker {...props} value="GONE_KEY" />);
    expect(screen.getByRole("combobox", { name: "Key secret" })).toHaveTextContent("GONE_KEY");
  });
});

import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { AiEndpointFields } from "./ai-endpoint-fields";
import type { FormValues } from "./monitor-form";

function Harness({ defaults, locations = 1 }: { defaults: Partial<FormValues>; locations?: number }) {
  const form = useForm<FormValues>({ defaultValues: { name: "n", type: "http_request", interval: "300", ...defaults } as FormValues });
  return (
    <Form {...form}>
      <AiEndpointFields form={form} projectId="p1" locationCount={locations} />
    </Form>
  );
}

describe("AiEndpointFields", () => {
  beforeEach(() => {
    hookState = { data: ["OPENAI_KEY"], isLoading: false, isError: false, isFetching: false, refetch: jest.fn() };
  });

  it("renders every preset field with a label and the monthly call count", () => {
    render(<Harness defaults={{}} locations={3} />);
    for (const label of ["Key header", "Model", "Prompt", "Max tokens", "Reply must contain", "First token limit (seconds)", "Total time limit (seconds)"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: "API key secret" })).toBeInTheDocument();
    expect(screen.getByTestId("ai-monthly-calls")).toHaveTextContent("about 25,920 calls a month");
  });

  it("No key hides the secret picker and disables the key header", () => {
    render(<Harness defaults={{ aiConfig_noKey: true }} />);
    expect(screen.queryByRole("combobox", { name: "API key secret" })).toBeNull();
    expect(screen.getByText("No key is sent.")).toBeInTheDocument();
    expect(screen.getByTestId("ai-key-header")).toBeDisabled();
    fireEvent.click(screen.getByTestId("ai-no-key"));
    expect(screen.getByRole("combobox", { name: "API key secret" })).toBeInTheDocument();
  });
});

describe("addAiEndpointIssues", () => {
  const issues = (data: Record<string, unknown>) => {
    const found: string[] = [];
    addAiEndpointIssues({ interval: "300", aiConfig_model: "m", aiConfig_secretKey: "KEY", ...data } as never, {
      addIssue: (i: { path?: (string | number)[] }) => found.push(String(i.path?.[0])),
    } as never);
    return found;
  };

  it("rejects an invalid key header only while a key is sent", () => {
    expect(issues({ aiConfig_keyHeader: "bad header" })).toEqual(["aiConfig_keyHeader"]);
    expect(issues({ aiConfig_keyHeader: "bad header", aiConfig_noKey: true, aiConfig_secretKey: "" })).toEqual([]);
  });

  it.each(["Host", "content-length", "Content-Type", "ACCEPT", "Transfer-Encoding", "connection", "Cookie"])("rejects the header name the API forbids: %s", (name) => {
    expect(issues({ aiConfig_keyHeader: name })).toEqual(["aiConfig_keyHeader"]);
  });

  it("keeps the first token limit within the total time limit (default 60 s)", () => {
    expect(issues({ aiConfig_firstTokenTimeoutSeconds: "60" })).toEqual([]);
    expect(issues({ aiConfig_firstTokenTimeoutSeconds: "10.5", aiConfig_timeoutSeconds: "10" })).toEqual(["aiConfig_firstTokenTimeoutSeconds"]);
    expect(issues({ aiConfig_firstTokenTimeoutSeconds: "10", aiConfig_timeoutSeconds: "10" })).toEqual([]);
    expect(issues({ aiConfig_firstTokenTimeoutSeconds: "0.5" })).toEqual([]);
    expect(issues({ aiConfig_firstTokenTimeoutSeconds: "0.4" })).toEqual(["aiConfig_firstTokenTimeoutSeconds"]);
  });
});

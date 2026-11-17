import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { McpServerFields } from "./mcp-server-fields";
import type { FormValues } from "./monitor-form";

jest.mock("./secret-picker", () => ({ SecretPicker: () => null }));

let formApi: UseFormReturn<FormValues> | undefined;
const keepForm = (form: UseFormReturn<FormValues>) => {
  formApi = form;
};
function Harness({ toolName = "" }: { toolName?: string }) {
  const form = useForm<FormValues>({ defaultValues: { type: "mcp_server", mcpConfig_toolName: toolName, mcpConfig_timeoutSeconds: "30" } as FormValues });
  useEffect(() => keepForm(form), [form]);
  return (
    <Form {...form}>
      <McpServerFields form={form} projectId="p1" />
    </Form>
  );
}

describe("McpServerFields sections", () => {
  it("starts with Call a tool and Advanced closed, so the form fits without scrolling", () => {
    render(<Harness />);
    expect(screen.queryByTestId("mcp-tool-name")).toBeNull();
    expect(screen.queryByTestId("mcp-timeout")).toBeNull();
  });

  it("opens Call a tool when editing a monitor that already calls one", () => {
    render(<Harness toolName="search_docs" />);
    expect(screen.getByTestId("mcp-tool-name")).toHaveValue("search_docs");
  });

  it("opens Advanced on an error and keeps it open once the value is fixed", () => {
    render(<Harness />);
    act(() => formApi!.setError("mcpConfig_timeoutSeconds", { message: "Enter a whole number from 5 to 60" }));
    const timeout = screen.getByTestId("mcp-timeout");
    fireEvent.change(timeout, { target: { value: "7" } });
    act(() => formApi!.clearErrors("mcpConfig_timeoutSeconds"));
    expect(screen.getByTestId("mcp-timeout")).toHaveValue("7");
  });
});

import { types } from "@/components/tests/data";
import { CREATE_ACTIONS } from "@/lib/create-actions";
import { formatTestTypeBreakdown } from "@/lib/dashboard/test-types";
import { ScriptType, getSampleScript } from "@/lib/script-service";
import { TYPE_TONE } from "@/lib/type-tones";

it("offers the agent type in the lists that read the type registry", () => {
  expect(types.find((t) => t.value === "agent")).toMatchObject({ label: "Agent" });
  expect(CREATE_ACTIONS.find((a) => a.id === "test-agent")).toMatchObject({ title: "Agent Test", url: "/playground?scriptType=agent" });
  expect(formatTestTypeBreakdown([{ type: "agent", count: 2 }])).toBe("2 agent");
  expect(TYPE_TONE.test.agent).toBe("purple");
});

it("starts a new agent test from the no-setup quick start", () => {
  expect(getSampleScript(ScriptType.Agent)).toContain("@supercheck/agent-test");
  expect(getSampleScript(ScriptType.Agent)).toContain("mcp.deepwiki.com");
});

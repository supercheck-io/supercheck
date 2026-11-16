/** Public types of @supercheck/agent-test. agent-test-types.d.ts (app, Monaco) must repeat them: agent-test-types.spec.ts checks. */
export interface AgentCommonOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  /** Default 30000, max 120000. */
  timeoutMs?: number;
}

export interface OpenAIAgentOptions extends AgentCommonOptions {
  kind: 'openai';
  /** Chat completions endpoint. */
  url: string;
  model: string;
  system?: string;
  tools?: unknown[];
}

export interface HttpAgentOptions extends AgentCommonOptions {
  kind: 'http';
  url: string;
  /** Builds the JSON body from the message. */
  body: (message: string) => unknown;
  /** Dot path of the reply text in the JSON response, e.g. "data.answer" or "choices.0.text". */
  reply: string;
}

export interface A2AAgentOptions extends AgentCommonOptions {
  kind: 'a2a';
  url: string;
  /** Send the A2A 0.3 `message/send` instead of the 1.0 `SendMessage`. */
  legacy?: boolean;
}

export interface McpAgentOptions extends AgentCommonOptions {
  kind: 'mcp';
  /** Streamable HTTP endpoint of the MCP server. */
  url: string;
  tool: string;
  /** Name of the tool argument that receives the message. Default "message". */
  argument?: string;
}

export type AgentOptions =
  OpenAIAgentOptions | HttpAgentOptions | A2AAgentOptions | McpAgentOptions;

export interface AgentToolCall {
  name: string;
  arguments: unknown;
}

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface AgentReply {
  text: string;
  json?: unknown;
  toolCalls: AgentToolCall[];
  toolNames: string[];
  usage: AgentUsage;
  durationMs: number;
  raw: unknown;
}

export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentClient {
  /** `conversation` holds earlier turns; only the openai kind sends them. */
  send(
    message: string,
    options?: { conversation?: AgentTurn[] },
  ): Promise<AgentReply>;
}

export interface AgentRepeatResult {
  attempts: number;
  passed: number;
  failed: number;
  passRate: number;
  failures: { attempt: number; message: string }[];
}

export interface AgentJudgeOptions {
  url: string;
  apiKey?: string;
  model: string;
}

export interface AgentJudgeResult {
  pass: boolean;
  reason: string;
}

export interface Agent {
  connect(options: AgentOptions): AgentClient;
  /** n 1-20, concurrency 1-5. Never throws for a failing attempt; 200 s budget. */
  repeat(
    n: number,
    fn: () => Promise<unknown>,
    options?: { concurrency?: number },
  ): Promise<AgentRepeatResult>;
  /** Grades `text` against `rubric` with your own OpenAI-compatible model. */
  judge(
    text: string,
    rubric: string,
    options: AgentJudgeOptions,
  ): Promise<AgentJudgeResult>;
}

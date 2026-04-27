export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Plan {
  summary: string;
  steps: string[];
  sites: string[];
}

export type AgentAction =
  | { tool: 'click'; targetId?: number | string; target?: string; rationale: string }
  | { tool: 'type'; targetId?: number | string; target?: string; value: string; rationale: string }
  | { tool: 'navigate'; url: string; rationale: string }
  | { tool: 'scroll'; direction: 'down' | 'up'; rationale: string }
  | { tool: 'click_at'; x: number; y: number; rationale: string }
  | { tool: 'press_key'; key: string; rationale: string }
  | { tool: 'hotkey'; keys: string[]; rationale: string }
  | { tool: 'type_text'; value: string; rationale: string }
  | { tool: 'screenshot'; rationale: string }
  | { tool: 'get_console_errors'; rationale: string }
  | { tool: 'get_network_failures'; rationale: string }
  | { tool: 'wait'; ms: number; rationale: string }
  | { tool: 'observe'; rationale: string }
  | { tool: 'read_page'; rationale: string }
  | { tool: 'find_in_page'; query: string; limit?: number; rationale: string }
  | { tool: 'remember'; key: string; value: string; rationale: string }
  | { tool: 'recall'; key?: string; rationale: string }
  | { tool: 'finish'; summary: string };

export interface ProviderConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  model: string;
  sendScreenshots?: boolean;
}

export interface ProposePlanInput {
  history: Message[];
  currentTab: { url: string; title: string };
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export interface RunAgentStepInput {
  plan: Plan;
  history: Message[];
  dom: string;
  screenshot?: string;
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export interface Provider {
  proposePlan(input: ProposePlanInput): Promise<Plan>;
  runAgentStep(input: RunAgentStepInput): Promise<AgentAction>;
}

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
  | { tool: 'click'; targetId: number; rationale: string }
  | { tool: 'type'; targetId: number; value: string; rationale: string }
  | { tool: 'navigate'; url: string; rationale: string }
  | { tool: 'scroll'; direction: 'down' | 'up'; rationale: string }
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
}

export interface RunAgentStepInput {
  plan: Plan;
  history: Message[];
  dom: string;
  screenshot?: string;
  signal: AbortSignal;
}

export interface Provider {
  proposePlan(input: ProposePlanInput): Promise<Plan>;
  runAgentStep(input: RunAgentStepInput): Promise<AgentAction>;
}

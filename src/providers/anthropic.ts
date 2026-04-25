import { validatePlan } from '../agent/plan';
import { PROPOSE_PLAN_SCHEMA, TOOL_SCHEMAS, type ToolSchema } from './toolSchemas';
import type {
  AgentAction,
  Plan,
  Provider,
  ProviderConfig,
  ProposePlanInput,
  RunAgentStepInput,
} from './types';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

interface AnthropicToolUseBlock {
  type?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicToolUseBlock[];
}

export class AnthropicProvider implements Provider {
  private cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
  }

  async proposePlan(input: ProposePlanInput): Promise<Plan> {
    const data = await this.post({
      system: this.systemPromptForPlan(input.currentTab),
      messages: input.history.map((message) => ({
        role: roleFor(message.role),
        content: message.content,
      })),
      tools: [PROPOSE_PLAN_SCHEMA],
      tool_choice: { type: 'tool', name: 'propose_plan' },
      signal: input.signal,
    });
    const block = data.content?.find((content) => content.type === 'tool_use');
    if (!block) throw new Error('Anthropic proposePlan: no tool_use block in response');
    return validatePlan(block.input);
  }

  async runAgentStep(input: RunAgentStepInput): Promise<AgentAction> {
    const data = await this.post({
      system: this.systemPromptForStep(input.plan),
      messages: [
        ...input.history.map((message) => ({
          role: roleFor(message.role),
          content: message.content,
        })),
        { role: 'user', content: `INTERACTIVE ELEMENTS:\n${input.dom}\n\nPick the next tool.` },
      ],
      tools: TOOL_SCHEMAS,
      tool_choice: { type: 'any' },
      signal: input.signal,
    });
    const block = data.content?.find((content) => content.type === 'tool_use');
    if (!block) throw new Error('Anthropic runAgentStep: no tool_use block in response');
    return toAgentAction(String(block.name ?? ''), asRecord(block.input));
  }

  private async post(opts: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: ToolSchema[];
    tool_choice: { type: 'tool'; name: string } | { type: 'any' };
    signal: AbortSignal;
  }): Promise<AnthropicResponse> {
    const body = {
      model: this.cfg.model,
      max_tokens: 4096,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      tool_choice: opts.tool_choice,
    };
    const url = `${(this.cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${text}`);
    }
    return res.json() as Promise<AnthropicResponse>;
  }

  private systemPromptForPlan(currentTab: { url: string; title: string }) {
    return [
      'You are a browser automation agent.',
      `The user is on: ${currentTab.url} ("${currentTab.title}").`,
      'Before any action, you MUST call propose_plan with the sites you need permission to act on and the steps you will take.',
      'Sites must be origins like "https://example.com" - no paths, no wildcards.',
    ].join('\n');
  }

  private systemPromptForStep(plan: Plan) {
    return [
      "You are executing an approved plan in the user's browser tab.",
      `Plan summary: ${plan.summary}`,
      `Steps:\n${plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
      `Approved sites: ${plan.sites.join(', ')}`,
      'On each turn, call exactly ONE of: click, type, navigate, scroll, finish.',
      'When done, call finish with a user-facing summary.',
    ].join('\n');
  }
}

function roleFor(role: 'user' | 'assistant' | 'system'): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user';
}

function toAgentAction(tool: string, args: Record<string, unknown>): AgentAction {
  switch (tool) {
    case 'click':
      return { tool: 'click', targetId: Number(args.targetId), rationale: String(args.rationale ?? '') };
    case 'type':
      return {
        tool: 'type',
        targetId: Number(args.targetId),
        value: String(args.value ?? ''),
        rationale: String(args.rationale ?? ''),
      };
    case 'navigate':
      return { tool: 'navigate', url: String(args.url), rationale: String(args.rationale ?? '') };
    case 'scroll':
      return {
        tool: 'scroll',
        direction: args.direction === 'up' ? 'up' : 'down',
        rationale: String(args.rationale ?? ''),
      };
    case 'finish':
      return { tool: 'finish', summary: String(args.summary ?? '') };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

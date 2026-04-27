import { validatePlan } from '../agent/plan';
import { PROPOSE_PLAN_SCHEMA, TOOL_SCHEMAS, type ToolSchema } from './toolSchemas';
import type {
  AgentAction,
  Message,
  Plan,
  Provider,
  ProviderConfig,
  ProposePlanInput,
  RunAgentStepInput,
} from './types';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

interface AnthropicToolUseBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicToolUseBlock[];
}

type AnthropicContent =
  | string
  | Array<
      | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent;
}

const ACTION_PREFIX = 'ACTION: ';
const RESULT_PREFIX = 'RESULT: ';

function parseActionPayload(text: string): { id: string; name: string; input: unknown } | null {
  if (!text.startsWith(ACTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(ACTION_PREFIX.length));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.tool !== 'string') return null;
    const { tool, ...rest } = parsed as { tool: string } & Record<string, unknown>;
    return { id: `aiside_${tool}_${Math.abs(hashCode(text)).toString(36)}`, name: tool, input: rest };
  } catch {
    return null;
  }
}

function parseResultPayload(text: string): string | null {
  if (!text.startsWith(RESULT_PREFIX)) return null;
  return text.slice(RESULT_PREFIX.length);
}

function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pendingToolUseId: string | null = null;

  for (const message of messages) {
    if (message.role === 'assistant') {
      const action = parseActionPayload(message.content);
      if (action) {
        pendingToolUseId = action.id;
        out.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: action.id, name: action.name, input: action.input }],
        });
        continue;
      }
      out.push({ role: 'assistant', content: message.content });
      pendingToolUseId = null;
      continue;
    }

    const result = parseResultPayload(message.content);
    if (result && pendingToolUseId) {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: pendingToolUseId, content: result }],
      });
      pendingToolUseId = null;
      continue;
    }
    out.push({ role: 'user', content: message.content });
    pendingToolUseId = null;
  }

  return out;
}

export class AnthropicProvider implements Provider {
  private cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
  }

  async proposePlan(input: ProposePlanInput): Promise<Plan> {
    const data = await this.post({
      system: this.systemPromptForPlan(input.currentTab),
      messages: toAnthropicMessages(input.history),
      tools: [PROPOSE_PLAN_SCHEMA],
      tool_choice: { type: 'tool', name: 'propose_plan' },
      signal: input.signal,
      cacheTools: true,
    });
    const block = data.content?.find((content) => content.type === 'tool_use');
    if (!block) throw new Error('Anthropic proposePlan: no tool_use block in response');
    return validatePlan(block.input);
  }

  async runAgentStep(input: RunAgentStepInput): Promise<AgentAction> {
    const messages = toAnthropicMessages(input.history);
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `INTERACTIVE ELEMENTS:\n${input.dom}\n\nPick the next tool.` },
      ],
    });
    const data = await this.post({
      system: this.systemPromptForStep(input.plan),
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: { type: 'any' },
      signal: input.signal,
      cacheTools: true,
    });
    const block = data.content?.find((content) => content.type === 'tool_use');
    if (!block) throw new Error('Anthropic runAgentStep: no tool_use block in response');
    return toAgentAction(String(block.name ?? ''), asRecord(block.input));
  }

  private async post(opts: {
    system: string;
    messages: AnthropicMessage[];
    tools: ToolSchema[];
    tool_choice: { type: 'tool'; name: string } | { type: 'any' };
    signal: AbortSignal;
    cacheTools?: boolean;
  }): Promise<AnthropicResponse> {
    const tools = opts.tools.map((tool, index) => {
      const base = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      };
      if (opts.cacheTools && index === opts.tools.length - 1) {
        return { ...base, cache_control: { type: 'ephemeral' } };
      }
      return base;
    });
    const body = {
      model: this.cfg.model,
      max_tokens: 4096,
      system: opts.system,
      messages: opts.messages,
      tools,
      tool_choice: opts.tool_choice,
    };
    const url = `${(this.cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        Authorization: `Bearer ${this.cfg.apiKey}`,
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
      'On each turn, call exactly ONE available tool.',
      'Use click/type with targetId from the DOM, or target when the user mentioned a page element token.',
      'Use click_at when the page is visually clear but DOM targets are missing; x/y are viewport coordinates from the visible screenshot.',
      'Use press_key, hotkey, and type_text for focused editors, checklist flows, keyboard navigation, and apps like iCloud Notes.',
      'Use observe to refresh page state, screenshot for visual state, get_console_errors/get_network_failures for debugging, wait for short asynchronous changes, remember/recall for page-local facts, and finish when done.',
      'When done, call finish with a user-facing summary.'
    ].join('\n');
  }
}

function toAgentAction(tool: string, args: Record<string, unknown>): AgentAction {
  switch (tool) {
    case 'click':
      return {
        tool: 'click',
        targetId: optionalNumberOrString(args.targetId),
        target: optionalString(args.target),
        rationale: String(args.rationale ?? ''),
      };
    case 'type':
      return {
        tool: 'type',
        targetId: optionalNumberOrString(args.targetId),
        target: optionalString(args.target),
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
    case 'click_at':
      return {
        tool: 'click_at',
        x: Number(args.x),
        y: Number(args.y),
        rationale: String(args.rationale ?? ''),
      };
    case 'press_key':
      return { tool: 'press_key', key: String(args.key ?? ''), rationale: String(args.rationale ?? '') };
    case 'hotkey':
      return { tool: 'hotkey', keys: stringArray(args.keys), rationale: String(args.rationale ?? '') };
    case 'type_text':
      return { tool: 'type_text', value: String(args.value ?? ''), rationale: String(args.rationale ?? '') };
    case 'screenshot':
      return { tool: 'screenshot', rationale: String(args.rationale ?? '') };
    case 'get_console_errors':
      return { tool: 'get_console_errors', rationale: String(args.rationale ?? '') };
    case 'get_network_failures':
      return { tool: 'get_network_failures', rationale: String(args.rationale ?? '') };
    case 'wait':
      return { tool: 'wait', ms: Number(args.ms ?? 1000), rationale: String(args.rationale ?? '') };
    case 'observe':
      return { tool: 'observe', rationale: String(args.rationale ?? '') };
    case 'remember':
      return {
        tool: 'remember',
        key: String(args.key ?? ''),
        value: String(args.value ?? ''),
        rationale: String(args.rationale ?? ''),
      };
    case 'recall':
      return {
        tool: 'recall',
        key: optionalString(args.key),
        rationale: String(args.rationale ?? ''),
      };
    case 'read_page':
      return { tool: 'read_page', rationale: String(args.rationale ?? '') };
    case 'find_in_page':
      return {
        tool: 'find_in_page',
        query: String(args.query ?? ''),
        limit: optionalNumber(args.limit),
        rationale: String(args.rationale ?? ''),
      };
    case 'finish':
      return { tool: 'finish', summary: String(args.summary ?? '') };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function optionalNumberOrString(value: unknown): number | string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && /^\d+$/.test(trimmed)) return parsed;
    return trimmed;
  }
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

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

interface ChatMessage {
  role: string;
  content: string;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

export class OpenAIProvider implements Provider {
  private cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.cfg = cfg;
  }

  async proposePlan(input: ProposePlanInput): Promise<Plan> {
    const messages = [
      {
        role: 'system',
        content: this.systemPromptForPlan(input.currentTab),
      },
      ...input.history,
    ];
    const data = await this.post(
      messages,
      [PROPOSE_PLAN_SCHEMA],
      { type: 'function', function: { name: 'propose_plan' } },
      input.signal,
      input.onChunk,
    );
    const choice = data.choices?.[0]?.message;
    if (choice?.tool_calls?.[0]?.function) {
      const args = JSON.parse(choice.tool_calls[0].function.arguments ?? '{}');
      return validatePlan(args);
    }
    if (typeof choice?.content === 'string') {
      try {
        return validatePlan(JSON.parse(choice.content));
      } catch {
        // Fallback to markdown block parsing
      }
      const match = choice.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) return validatePlan(JSON.parse(match[1]));
    }
    throw new Error('OpenAI proposePlan: no tool_calls and no JSON block in response');
  }

  async runAgentStep(input: RunAgentStepInput): Promise<AgentAction> {
    const messages = [
      { role: 'system', content: this.systemPromptForStep(input.plan) },
      ...input.history,
      {
        role: 'user',
        content: `INTERACTIVE ELEMENTS:\n${input.dom}\n\nPick the next tool to call.`,
      },
    ];
    const data = await this.post(messages, TOOL_SCHEMAS, 'required', input.signal, input.onChunk);
    const choice = data.choices?.[0]?.message;
    const call = choice?.tool_calls?.[0];
    if (call?.function) {
      const args = asRecord(JSON.parse(call.function.arguments ?? '{}'));
      return toAgentAction(String(call.function.name ?? ''), args);
    }
    if (typeof choice?.content === 'string') {
      try {
        const parsed = JSON.parse(choice.content);
        if (isRecord(parsed) && parsed.tool) return toAgentAction(String(parsed.tool), parsed);
      } catch {
        // Fallback to markdown block parsing
      }
      const match = choice.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        if (isRecord(parsed) && parsed.tool) return toAgentAction(String(parsed.tool), parsed);
      }
    }
    throw new Error('OpenAI runAgentStep: no tool_calls in response');
  }

  private async post(
    messages: ChatMessage[],
    tools: ToolSchema[],
    toolChoice: 'required' | { type: 'function'; function: { name: string } },
    signal: AbortSignal,
    onChunk?: (chunk: string) => void,
  ): Promise<OpenAIResponse> {
    const url = `${(this.cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages,
      stream: true,
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
      tool_choice: toolChoice,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API ${res.status}: ${text}`);
    }

    const contentType = res.headers?.get?.('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let content = '';
      const tool_calls: Array<{ function: { name: string; arguments: string } }> = [];
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (let line of lines) {
            line = line.trim();
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (delta) {
                  if (delta.content) {
                    content += delta.content;
                    onChunk?.(delta.content);
                  }
                  if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                      const index = tc.index || 0;
                      if (!tool_calls[index]) {
                        tool_calls[index] = { function: { name: '', arguments: '' } };
                      }
                      if (tc.function?.name) {
                        tool_calls[index].function.name += tc.function.name;
                      }
                      if (tc.function?.arguments) {
                        tool_calls[index].function.arguments += tc.function.arguments;
                        onChunk?.(tc.function.arguments);
                      }
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }
      return {
        choices: [
          {
            message: {
              content: content || undefined,
              tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
            },
          },
        ],
      } as OpenAIResponse;
    }

    return res.json() as Promise<OpenAIResponse>;
  }

  private systemPromptForPlan(currentTab: { url: string; title: string }) {
    return [
      'You are a browser automation agent.',
      `The user is on: ${currentTab.url} ("${currentTab.title}").`,
      'Before any action, you MUST call propose_plan describing the sites you need permission to act on and the steps you will take.',
      'Sites must be origins like "https://example.com" - no paths, no wildcards.',
    ].join('\n');
  }

  private systemPromptForStep(plan: Plan) {
    return [
      "You are executing an approved plan in the user's browser tab.",
      `Plan summary: ${plan.summary}`,
      `Steps:\n${plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
      `Approved sites: ${plan.sites.join(', ')}`,
      'On each turn, call exactly ONE of these tools: click, type, navigate, scroll, finish.',
      'When the task is done, call finish with a user-facing summary.',
    ].join('\n');
  }
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

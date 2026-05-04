import type { AgentAction } from '../../providers/types';

export type ToolRuntime = 'content' | 'background' | 'loop';
export type ToolRisk = 'safe' | 'destructive' | 'high-risk';

export interface ToolSchemaShape {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: ToolSchemaShape;
}

export interface BgCtx {
  agentTabId: number;
}

export interface ToolResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

export interface ToolDef<A extends AgentAction = AgentAction> {
  name: A['tool'];
  description: string;
  inputSchema: ToolSchemaShape;
  risk: ToolRisk;
  runtime: ToolRuntime;
  coerce: (args: Record<string, unknown>) => A;
  describe: (action: A) => Record<string, unknown>;
  toContentPayload?: (action: A) => Record<string, unknown>;
  runInBackground?: (action: A, ctx: BgCtx) => Promise<ToolResult>;
  summarize: (entry: { args: Record<string, unknown>; message: string }) => string;
}

class Registry {
  private byName = new Map<string, ToolDef>();

  register<A extends AgentAction>(def: ToolDef<A>): void {
    if (this.byName.has(def.name)) {
      throw new Error(`Duplicate tool registration: ${def.name}`);
    }
    this.byName.set(def.name, def as unknown as ToolDef);
  }

  get(name: string): ToolDef | undefined {
    return this.byName.get(name);
  }

  getOrThrow(name: string): ToolDef {
    const tool = this.byName.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  list(): ToolDef[] {
    return Array.from(this.byName.values());
  }

  schemas(): ToolSchema[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  byRisk(risk: ToolRisk): Set<string> {
    return new Set(this.list().filter((t) => t.risk === risk).map((t) => t.name));
  }

  byRuntime(runtime: ToolRuntime): ToolDef[] {
    return this.list().filter((t) => t.runtime === runtime);
  }
}

export const registry = new Registry();

export function defineTool<A extends AgentAction>(def: ToolDef<A>): ToolDef<A> {
  registry.register(def);
  return def;
}

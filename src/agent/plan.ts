import type { Plan } from '../providers/types';

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

export function normalizeOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new PlanValidationError(`Invalid URL: ${input}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PlanValidationError(`Unsupported scheme: ${parsed.protocol}`);
  }

  return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
}

export function validatePlan(input: unknown): Plan {
  if (!input || typeof input !== 'object') {
    throw new PlanValidationError('Plan must be an object');
  }

  const obj = input as Record<string, unknown>;
  const summary = obj.summary;
  if (typeof summary !== 'string' || summary.length === 0 || summary.length > 200) {
    throw new PlanValidationError('summary must be a non-empty string <= 200 chars');
  }

  const steps = obj.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 10) {
    throw new PlanValidationError('steps must be an array of 1-10 items');
  }
  for (const step of steps) {
    if (typeof step !== 'string' || step.length === 0 || step.length > 200) {
      throw new PlanValidationError('each step must be a non-empty string <= 200 chars');
    }
  }

  const sites = obj.sites;
  if (!Array.isArray(sites) || sites.length < 1 || sites.length > 5) {
    throw new PlanValidationError('sites must be an array of 1-5 origins');
  }

  const normalizedSites = sites.map((site) => {
    if (typeof site !== 'string') {
      throw new PlanValidationError('each site must be a string');
    }
    return normalizeOrigin(site);
  });

  return { summary, steps: steps as string[], sites: normalizedSites };
}

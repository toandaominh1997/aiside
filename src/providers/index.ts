import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import type { Provider, ProviderConfig } from './types';

export function selectProvider(cfg: ProviderConfig): Provider {
  if (!cfg.apiKey) throw new Error('apiKey is required');

  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider(cfg);
    case 'openai':
      return new OpenAIProvider(cfg);
    default:
      throw new Error(`Unknown provider: ${(cfg as { provider?: string }).provider}`);
  }
}

export type { Provider, ProviderConfig } from './types';

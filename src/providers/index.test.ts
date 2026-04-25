import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic';
import { selectProvider } from './index';
import { OpenAIProvider } from './openai';

describe('selectProvider', () => {
  it('returns OpenAIProvider for provider=openai', () => {
    const provider = selectProvider({
      provider: 'openai',
      apiKey: 'k',
      baseUrl: 'https://x',
      model: 'gpt-4o',
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('returns AnthropicProvider for provider=anthropic', () => {
    const provider = selectProvider({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-7',
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('throws when apiKey is missing', () => {
    expect(() => selectProvider({ provider: 'openai', apiKey: '', model: 'gpt-4o' })).toThrow();
  });
});

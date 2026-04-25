import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { list as listAllowed, revoke } from './agent/allowlist';
import './index.css';

type ProviderName = 'anthropic' | 'openai';

const DEFAULT_BASE_URLS: Record<ProviderName, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
};

const VISION_PREFIXES: Record<ProviderName, string[]> = {
  anthropic: ['claude-'],
  openai: ['gpt-4o', 'gpt-4-vision'],
};

const Options = () => {
  const [provider, setProvider] = useState<ProviderName>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.anthropic);
  const [model, setModel] = useState('claude-opus-4-7');
  const [sendScreenshots, setSendScreenshots] = useState(false);
  const [allowed, setAllowed] = useState<
    Array<{ origin: string; addedAt: number; lastUsedAt: number }>
  >([]);
  const [saved, setSaved] = useState(false);

  const refreshAllowed = async () => {
    setAllowed(await listAllowed());
  };

  useEffect(() => {
    chrome.storage.local.get(
      ['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'],
      (result) => {
        if (result.provider === 'openai' || result.provider === 'anthropic') {
          setProvider(result.provider);
        }
        if (result.apiKey) setApiKey(result.apiKey as string);
        if (result.baseUrl) setBaseUrl(result.baseUrl as string);
        if (result.model) setModel(result.model as string);
        setSendScreenshots(Boolean(result.sendScreenshots));
      },
    );
    void listAllowed().then((entries) => setAllowed(entries));
  }, []);

  const visionSupported = VISION_PREFIXES[provider].some((prefix) =>
    model.toLowerCase().startsWith(prefix),
  );

  const handleSave = () => {
    chrome.storage.local.set({ provider, apiKey, baseUrl, model, sendScreenshots }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  const handleProviderChange = (nextProvider: ProviderName) => {
    setProvider(nextProvider);
    if (
      !baseUrl ||
      baseUrl === DEFAULT_BASE_URLS.anthropic ||
      baseUrl === DEFAULT_BASE_URLS.openai
    ) {
      setBaseUrl(DEFAULT_BASE_URLS[nextProvider]);
    }
  };

  const handleRevoke = async (origin: string) => {
    await revoke(origin);
    await refreshAllowed();
  };

  const handleRevokeAll = async () => {
    if (!confirm('Revoke all site permissions?')) return;
    for (const entry of allowed) {
      await revoke(entry.origin);
    }
    await refreshAllowed();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-xl space-y-8">
        <h1 className="text-2xl font-bold text-gray-800">Aiside Configuration</h1>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Provider</h2>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="provider"
                value="anthropic"
                checked={provider === 'anthropic'}
                onChange={() => handleProviderChange('anthropic')}
              />
              Anthropic
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="provider"
                value="openai"
                checked={provider === 'openai'}
                onChange={() => handleProviderChange('openai')}
              />
              OpenAI-compatible
            </label>
          </div>

          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            />
          </div>

          <div>
            <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 mb-1">
              Base URL
            </label>
            <input
              id="baseUrl"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder={DEFAULT_BASE_URLS[provider]}
            />
            <p className="mt-1 text-xs text-gray-500">
              {provider === 'anthropic'
                ? 'Default: https://api.anthropic.com/v1'
                : 'For example: https://api.openai.com/v1 or http://localhost:11434/v1'}
            </p>
          </div>

          <div>
            <label htmlFor="modelName" className="block text-sm font-medium text-gray-700 mb-1">
              Model Name
            </label>
            <input
              id="modelName"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder={provider === 'anthropic' ? 'claude-opus-4-7' : 'gpt-4o'}
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Agent settings</h2>
          <label
            className="flex items-center gap-2"
            title={visionSupported ? '' : "Selected model doesn't support image input"}
          >
            <input
              type="checkbox"
              checked={sendScreenshots}
              disabled={!visionSupported}
              onChange={(event) => setSendScreenshots(event.target.checked)}
            />
            <span className={visionSupported ? '' : 'text-gray-400'}>
              Send screenshots to model (more accurate, ~2x cost)
            </span>
          </label>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Site permissions</h2>
          {allowed.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aiside hasn't been approved to act on any sites yet.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md">
                {allowed.map((entry) => (
                  <li
                    key={entry.origin}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium break-all">{entry.origin}</div>
                      <div className="text-xs text-gray-500">
                        added {new Date(entry.addedAt).toLocaleDateString()} - last used{' '}
                        {entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : 'never'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(entry.origin)}
                      className="text-red-600 text-xs font-medium hover:underline"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleRevokeAll}
                className="text-xs text-red-600 hover:underline"
              >
                Revoke all
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Options;

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<Options />);
  }
}

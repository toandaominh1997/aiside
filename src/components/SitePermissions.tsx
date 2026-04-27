import { useEffect, useState } from 'react';
import {
  addOrigins,
  ALLOWLIST_STORAGE_KEY,
  type Allowlist,
  type PerActionMode,
  loadAllowlist,
  revokeAll,
  revokeOrigin,
  setOriginActMode,
} from '../agent/allowlist';

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

export function SitePermissions() {
  const [list, setList] = useState<Allowlist>({ version: 1, origins: {} });
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [newBlockedOrigin, setNewBlockedOrigin] = useState('');
  const [blockError, setBlockError] = useState('');

  useEffect(() => {
    void loadAllowlist().then(setList);
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
      if (changes[ALLOWLIST_STORAGE_KEY]) {
        void loadAllowlist().then(setList);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const entries = Object.entries(list.origins).sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt);

  async function blockOrigin() {
    const raw = newBlockedOrigin.trim();
    if (!raw) return;
    setBlockError('');
    let normalized: string;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid origin');
      normalized = parsed.origin.toLowerCase();
    } catch {
      setBlockError('Enter a valid http:// or https:// origin.');
      return;
    }
    const next = await addOrigins([normalized]);
    if (!next.origins[normalized]) {
      setBlockError('Enter a valid http:// or https:// origin.');
      return;
    }
    await setOriginActMode(normalized, 'never');
    setNewBlockedOrigin('');
  }

  return (
    <section className="space-y-3" data-testid="site-permissions">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-gray-500">Blocked sites</h2>
        {entries.length > 0 && !confirmRevokeAll && (
          <button
            type="button"
            onClick={() => setConfirmRevokeAll(true)}
            className="text-xs text-red-600 hover:underline"
          >
            Clear all blocks
          </button>
        )}
        {confirmRevokeAll && (
          <div role="dialog" aria-label="Confirm clear all blocks" className="flex items-center gap-2 text-xs">
            <span className="text-gray-700">Clear all blocked sites?</span>
            <button
              type="button"
              onClick={async () => {
                await revokeAll();
                setConfirmRevokeAll(false);
              }}
              className="text-red-600 font-medium hover:underline"
            >
              Yes, clear all
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevokeAll(false)}
              className="text-gray-600 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void blockOrigin();
        }}
      >
        <div className="flex-1 min-w-[220px]">
          <input
            aria-label="Origin to block"
            value={newBlockedOrigin}
            onChange={(event) => setNewBlockedOrigin(event.target.value)}
            placeholder="https://example.com"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          {blockError && <p className="mt-1 text-xs text-red-600">{blockError}</p>}
        </div>
        <button type="submit" className="border border-gray-300 rounded px-3 py-1 text-sm hover:bg-gray-50">
          Block site
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          All http:// and https:// sites are approved by default. Add origins here only when you want AISide to ask first or block actions.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-1">Origin</th>
              <th className="text-left py-1">Mode</th>
              <th className="text-left py-1">Last used</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {entries.map(([origin, policy]) => (
              <tr key={origin} className="border-t border-gray-200">
                <td className="font-mono py-1 truncate max-w-[260px]">{origin}</td>
                <td className="py-1">
                  <select
                    aria-label={`Mode for ${origin}`}
                    value={policy.modes?.act ?? 'never'}
                    onChange={(event) =>
                      void setOriginActMode(origin, event.target.value as PerActionMode)
                    }
                    className="border border-gray-300 rounded px-2 py-0.5 text-xs"
                  >
                    <option value="ask">Ask</option>
                    <option value="auto">Auto</option>
                    <option value="never">Never</option>
                  </select>
                </td>
                <td className="py-1 text-gray-500">{formatDate(policy.lastUsedAt)}</td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    onClick={() => void revokeOrigin(origin)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

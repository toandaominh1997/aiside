import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageSquarePlus, MoreVertical } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { runPlan, type ActionLogEntry, type LoopDeps, type LoopResult } from './agent/loop';
import { validatePlan } from './agent/plan';
import {
  getAgentTabUrl,
  navigateAgentTab,
  onAgentTabClosed,
  openAgentTab,
  sendToAgentTab,
} from './agent/tabs';
import * as allowlist from './agent/allowlist';
import { ActionLogRow } from './components/ActionLogRow';
import { PlanCard } from './components/PlanCard';
import { selectProvider } from './providers/index';
import type { AgentAction, Message, Plan, ProviderConfig } from './providers/types';

type RunState = 'idle' | 'planning' | 'awaiting-approval' | 'running' | 'paused' | 'done' | 'error';

const MAX_STEPS = 25;

interface ChatItem {
  kind: 'message' | 'plan' | 'log';
  message?: Message;
  plan?: Plan;
  entry?: ActionLogEntry;
}

function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [pauseReason, setPauseReason] = useState('');
  const [config, setConfig] = useState<ProviderConfig>({
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'claude-opus-4-7',
    sendScreenshots: false,
  });
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const stopController = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chrome.storage.local.get(
      ['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'],
      (result) => {
        setConfig({
          provider: result.provider === 'openai' ? 'openai' : 'anthropic',
          apiKey: (result.apiKey as string) ?? '',
          baseUrl: (result.baseUrl as string) ?? 'https://api.openai.com/v1',
          model: (result.model as string) ?? 'claude-opus-4-7',
          sendScreenshots: Boolean(result.sendScreenshots),
        });
      },
    );

    const messageListener = (message: { type?: string; text?: string }) => {
      if (message.type === 'CONTEXT_MENU_SELECTION' && message.text) {
        setInput((previous) => `${previous}\n\nContext:\n"${message.text}"\n\n`);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const append = (item: ChatItem) => setItems((previous) => [...previous, item]);

  async function getCurrentTab(): Promise<{ url: string; title: string }> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs[0];
        resolve({ url: tab?.url ?? '', title: tab?.title ?? '' });
      });
    });
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || runState !== 'idle') return;
    if (!config.apiKey) {
      alert('Please configure your API key in the extension options.');
      chrome.runtime.openOptionsPage();
      return;
    }

    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    append({ kind: 'message', message: userMsg });

    setRunState('planning');
    const provider = selectProvider(config);
    stopController.current = new AbortController();

    try {
      const currentTab = await getCurrentTab();
      const rawPlan = await provider.proposePlan({
        history: [userMsg],
        currentTab,
        signal: stopController.current.signal,
      });
      const plan = validatePlan(rawPlan);
      setPendingPlan(plan);
      append({ kind: 'plan', plan });
      setRunState('awaiting-approval');
    } catch (err) {
      append({
        kind: 'message',
        message: { role: 'assistant', content: `Plan failed: ${(err as Error).message}` },
      });
      setRunState('error');
      setTimeout(() => setRunState('idle'), 0);
    }
  }

  async function handleApprove() {
    if (!pendingPlan) return;

    const plan = pendingPlan;
    setPendingPlan(null);
    setRunState('running');
    await allowlist.addAll(plan.sites);
    const tabId = await openAgentTab(plan.sites[0]);
    const dispose = onAgentTabClosed(tabId, () => {
      setRunState('paused');
      setPauseReason('Agent tab was closed');
      stopController.current?.abort();
    });

    const provider = selectProvider(config);
    stopController.current = new AbortController();
    const deps: LoopDeps = {
      agentTabId: tabId,
      getDomTree: () =>
        sendToAgentTab<{ dom: string; url: string; title: string }>(tabId, {
          type: 'GET_DOM_TREE',
        }),
      getCurrentUrl: () => getAgentTabUrl(tabId),
      executeAction: (action) =>
        sendToAgentTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: actionToContentPayload(action),
        }),
      navigate: (url) => navigateAgentTab(tabId, url),
      isAllowed: (origin) => allowlist.has(origin),
      onLog: (entry) => append({ kind: 'log', entry }),
      maxSteps: MAX_STEPS,
    };

    let result: LoopResult;
    try {
      result = await runPlan(plan, provider, deps, stopController.current.signal);
    } catch (err) {
      result = { status: 'error', error: err as Error };
    } finally {
      dispose();
    }

    if (result.status === 'done') {
      append({ kind: 'message', message: { role: 'assistant', content: result.summary } });
      await allowlist.touch(plan.sites[0]);
      setRunState('done');
      setTimeout(() => setRunState('idle'), 0);
    } else if (result.status === 'paused') {
      setPauseReason(result.reason);
      setRunState('paused');
    } else if (result.status === 'aborted') {
      append({ kind: 'message', message: { role: 'assistant', content: 'Stopped.' } });
      setRunState('idle');
    } else {
      append({
        kind: 'message',
        message: { role: 'assistant', content: `Error: ${result.error.message}` },
      });
      setRunState('error');
      setTimeout(() => setRunState('idle'), 0);
    }
  }

  function handleMakeChanges() {
    if (!pendingPlan) return;
    const draft = `Refine this plan:\n\nSummary: ${pendingPlan.summary}\nSites:\n${pendingPlan.sites
      .map((site) => `- ${site}`)
      .join('\n')}\nSteps:\n${pendingPlan.steps
      .map((step, index) => `${index + 1}. ${step}`)
      .join('\n')}\n\nMy changes: `;
    setInput(draft);
    setPendingPlan(null);
    setRunState('idle');
  }

  function handleStop() {
    stopController.current?.abort();
    setRunState('idle');
  }

  function clearHistory() {
    setItems([]);
    setRunState('idle');
    setPendingPlan(null);
  }

  return (
    <div className="flex flex-col h-screen bg-[#2b2d31] text-gray-200 font-sans">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-2 hover:bg-white/5 px-2 py-1 rounded-md"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <span className="text-[15px] font-medium">{config.model || 'Model'}</span>
        </button>
        <div className="flex items-center gap-4 text-gray-400">
          <button onClick={clearHistory} title="New chat">
            <MessageSquarePlus size={18} />
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()} title="Settings">
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto mt-[-40px]">
            <div className="w-16 h-16 bg-white rounded-lg flex items-center justify-center mb-6 shadow-sm">
              <span className="text-3xl">AI</span>
            </div>
            <h2 className="text-gray-300 text-[15px] mb-6">Take actions with Aiside</h2>
          </div>
        ) : (
          items.map((item, index) => {
            if (item.kind === 'message' && item.message) {
              const message = item.message;
              return (
                <div
                  key={index}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] text-[15px] leading-relaxed ${
                      message.role === 'user'
                        ? 'bg-[#383a40] text-gray-100 rounded-2xl px-4 py-3'
                        : 'text-gray-200 py-1'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    )}
                  </div>
                </div>
              );
            }

            if (item.kind === 'plan' && item.plan) {
              return (
                <PlanCard
                  key={index}
                  plan={item.plan}
                  onApprove={handleApprove}
                  onMakeChanges={handleMakeChanges}
                  disabled={runState !== 'awaiting-approval'}
                />
              );
            }

            if (item.kind === 'log' && item.entry) {
              return <ActionLogRow key={index} entry={item.entry} />;
            }

            return null;
          })
        )}

        {(runState === 'planning' || runState === 'running') && (
          <div className="flex justify-start">
            <div className="text-gray-400 py-2 flex items-center gap-2 text-sm">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <div
                className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <div
                className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </div>
          </div>
        )}

        {runState === 'paused' && (
          <div className="rounded-md border border-yellow-700 bg-yellow-900/20 text-yellow-200 px-3 py-2 text-sm">
            Paused - {pauseReason}.
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="p-4 pt-2">
        <div className="bg-[#383a40] border border-gray-600/50 rounded-2xl p-3 flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask Aiside..."
            className="w-full max-h-48 min-h-[24px] bg-transparent border-none resize-none text-[15px] text-gray-200 placeholder-gray-500 focus:outline-none"
            rows={1}
          />
          <div className="flex items-center justify-end">
            {runState === 'running' ? (
              <button onClick={handleStop} className="text-xs px-3 py-1 rounded-md bg-red-600 text-white">
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                aria-label="Send"
                disabled={!input.trim() || runState !== 'idle'}
                className={`p-1.5 rounded-full ${
                  input.trim() && runState === 'idle'
                    ? 'bg-[#d97757] text-white'
                    : 'bg-[#4a4c52] text-gray-500'
                }`}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <div className="text-center mt-3 text-[11px] text-gray-500">
          Aiside is AI and can make mistakes. Please double-check responses.
        </div>
      </footer>
    </div>
  );
}

function actionToContentPayload(action: AgentAction): {
  action: string;
  targetId?: number;
  value?: string;
} {
  switch (action.tool) {
    case 'click':
      return { action: 'click', targetId: action.targetId };
    case 'type':
      return { action: 'type', targetId: action.targetId, value: action.value };
    case 'scroll':
      return { action: 'scroll' };
    case 'navigate':
      return { action: 'navigate', value: action.url };
    case 'finish':
      return { action: 'finish' };
  }
}

export default App;

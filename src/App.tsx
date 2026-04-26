import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageSquarePlus, MoreVertical, ChevronDown, Zap, Hand, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { runPlan, type ActionLogEntry, type LoopDeps, type LoopResult } from './agent/loop';
import { validatePlan } from './agent/plan';
import {
  getAgentTabUrl,
  navigateAgentTab,
  onAgentTabClosed,
  sendToAgentTab,
} from './agent/tabs';
import { ActionLogRow } from './components/ActionLogRow';
import { CommandMenu } from './components/CommandMenu';
import { MentionMenu } from './components/MentionMenu';
import {
  filterCommands,
  helpMessage,
  parseSlashCommand,
  shouldShowMenu,
  type SlashCommand,
} from './agent/commands';
import {
  findActiveTrigger,
  formatContextBlock,
  rankMentions,
  resolveMentions,
  type ActiveTrigger,
  type Mention,
} from './agent/mentions';
import { selectProvider } from './providers/index';
import type { AgentAction, Message, Plan, ProviderConfig } from './providers/types';

type RunState = 'idle' | 'planning' | 'running' | 'paused' | 'done' | 'error';

const MAX_STEPS = 25;

interface ChatItem {
  kind: 'message' | 'log';
  message?: Message;
  entry?: ActionLogEntry;
}

function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [pauseReason, setPauseReason] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [menuIndex, setMenuIndex] = useState(0);
  const [mentionTrigger, setMentionTrigger] = useState<ActiveTrigger | null>(null);
  const [mentionItems, setMentionItems] = useState<Mention[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionsRef = useRef<Map<string, Mention>>(new Map());
  const mentionPoolRef = useRef<Mention[]>([]);
  const dismissedTriggerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [config, setConfig] = useState<ProviderConfig>({
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-opus-4-7',
    sendScreenshots: false,
  });
  const stopController = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadConfig = () => {
      chrome.storage.local.get(
        ['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'],
        (result) => {
          setConfig({
            provider: result.provider === 'openai' ? 'openai' : 'anthropic',
            apiKey: (result.apiKey as string) ?? '',
            baseUrl: (result.baseUrl as string) ?? 'https://api.anthropic.com/v1',
            model: (result.model as string) ?? 'claude-opus-4-7',
            sendScreenshots: Boolean(result.sendScreenshots),
          });
        },
      );
    };

    loadConfig();

    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') {
        const changedKeys = Object.keys(changes);
        if (['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'].some(k => changedKeys.includes(k))) {
          loadConfig();
        }
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    const messageListener = (message: { type?: string; text?: string }) => {
      if (message.type === 'CONTEXT_MENU_SELECTION' && message.text) {
        setInput((previous) => `${previous}\n\nContext:\n"${message.text}"\n\n`);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    setMenuIndex(0);
  }, [input]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.55)}px`;
  }, [input]);

  const append = (item: ChatItem) => setItems((previous) => [...previous, item]);

  const menuOpen = shouldShowMenu(input);
  const filteredCommands = menuOpen ? filterCommands(input) : [];
  const showMenu = menuOpen && filteredCommands.length > 0;
  const safeMenuIndex = filteredCommands.length === 0 ? 0 : menuIndex % filteredCommands.length;

  function runLocalCommand(local: 'new' | 'help') {
    if (local === 'new') {
      stopController.current?.abort();
      setItems([]);
      setRunState('idle');
      setStreamingText('');
      setPauseReason('');
      mentionsRef.current.clear();
      mentionPoolRef.current = [];
      dismissedTriggerRef.current = null;
      setMentionTrigger(null);
      setMentionItems([]);
    } else if (local === 'help') {
      append({
        kind: 'message',
        message: { role: 'assistant', content: helpMessage() },
      });
    }
  }

  function selectCommand(command: SlashCommand) {
    if (command.local) {
      runLocalCommand(command.local);
      setInput('');
    } else {
      setInput(`/${command.name} `);
    }
  }

  async function fetchMentionCandidates(): Promise<Mention[]> {
    try {
      const tab = await getCurrentTab();
      if (tab.id < 0) return [];
      const resp = await sendToAgentTab<{ mentions: Mention[] }>(tab.id, {
        type: 'GET_MENTION_CANDIDATES',
      });
      return resp.mentions ?? [];
    } catch {
      return [];
    }
  }

  function updateMentionState(value: string, caret: number) {
    const trigger = findActiveTrigger(value, caret);
    if (!trigger) {
      dismissedTriggerRef.current = null;
      mentionPoolRef.current = [];
      setMentionTrigger(null);
      setMentionItems([]);
      setMentionIndex(0);
      return;
    }
    if (dismissedTriggerRef.current === trigger.start) {
      setMentionTrigger(null);
      setMentionItems([]);
      return;
    }
    dismissedTriggerRef.current = null;
    setMentionTrigger(trigger);
    setMentionIndex(0);
    if (mentionPoolRef.current.length === 0) {
      void (async () => {
        const items = await fetchMentionCandidates();
        mentionPoolRef.current = items;
        setMentionItems(rankMentions(trigger.query, items));
      })();
      return;
    }
    setMentionItems(rankMentions(trigger.query, mentionPoolRef.current));
  }

  function insertMention(mention: Mention) {
    if (!mentionTrigger) return;
    const { start, end } = mentionTrigger;
    const before = input.slice(0, start);
    const after = input.slice(end);
    const inserted = `${mention.token} `;
    const next = `${before}${inserted}${after}`;
    setInput(next);
    mentionsRef.current.set(mention.token, mention);
    const caret = start + inserted.length;
    queueMicrotask(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
    setMentionTrigger(null);
    setMentionItems([]);
  }

  function handleInputChange(value: string, caret: number) {
    setInput(value);
    updateMentionState(value, caret);
  }

  async function getCurrentTab(): Promise<{ url: string; title: string; id: number }> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs[0];
        resolve({ url: tab?.url ?? '', title: tab?.title ?? '', id: tab?.id ?? -1 });
      });
    });
  }

  async function submitPrompt(text: string) {
    if (!text || runState !== 'idle') return;
    if (!config.apiKey) {
      alert('Please configure your API key in the extension options.');
      chrome.runtime.openOptionsPage();
      return;
    }

    setInput('');
    const { userText, mentioned } = resolveMentions(text, mentionsRef.current);
    const visibleMsg: Message = { role: 'user', content: userText };
    append({ kind: 'message', message: visibleMsg });

    const contextBlock = formatContextBlock(mentioned);
    const llmContent = contextBlock ? `${contextBlock}\n\n---\n\n${userText}` : userText;
    const llmMsg: Message = { role: 'user', content: llmContent };

    setRunState('planning');
    setStreamingText('');
    const provider = selectProvider(config);
    stopController.current = new AbortController();

    try {
      const currentTab = await getCurrentTab();
      const rawPlan = await provider.proposePlan({
        history: [llmMsg],
        currentTab,
        signal: stopController.current.signal,
        onChunk: (chunk) => setStreamingText((prev) => prev + chunk),
      });
      setStreamingText('');
      const plan = validatePlan(rawPlan);
      await startPlan(plan, currentTab.id);
    } catch (err) {
      setStreamingText('');
      append({
        kind: 'message',
        message: { role: 'assistant', content: `Plan failed: ${(err as Error).message}` },
      });
      setRunState('error');
      setTimeout(() => setRunState('idle'), 0);
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const parsed = parseSlashCommand(trimmed);
    if (parsed) {
      setInput('');
      if (parsed.command.local) {
        runLocalCommand(parsed.command.local);
        return;
      }
      if (parsed.command.expand) {
        await submitPrompt(parsed.command.expand(parsed.arg));
        return;
      }
    }
    await submitPrompt(trimmed);
  }

  async function startPlan(plan: Plan, tabId: number) {
    setRunState('running');
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

  function handleStop() {
    stopController.current?.abort();
    setRunState('idle');
  }

  function clearHistory() {
    setItems([]);
    setRunState('idle');
  }

  return (
    <div className="flex flex-col h-screen bg-[#2b2d31] text-gray-200 font-sans">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-1.5 hover:bg-white/5 active:bg-white/10 active:scale-95 transition-all duration-150 px-2 py-1 rounded-md text-gray-300"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <span className="text-[15px] font-medium">{config.model === 'claude-opus-4-7' ? 'Opus 4.7' : config.model}</span>
          <ChevronDown size={14} className="text-gray-500" />
        </button>
        <div className="flex items-center gap-1 text-gray-400">
          <button
            onClick={() => {}}
            title="Actions"
            className="p-1.5 rounded-md hover:bg-white/5 hover:text-gray-200 active:bg-white/10 active:scale-90 transition-all duration-150"
          >
            <Zap size={16} />
          </button>
          <button
            onClick={clearHistory}
            title="New chat"
            className="p-1.5 rounded-md hover:bg-white/5 hover:text-gray-200 active:bg-white/10 active:scale-90 transition-all duration-150"
          >
            <MessageSquarePlus size={16} />
          </button>
          <button
            onClick={() => chrome.runtime.openOptionsPage()}
            title="Settings"
            className="p-1.5 rounded-md hover:bg-white/5 hover:text-gray-200 active:bg-white/10 active:scale-90 transition-all duration-150"
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto mt-[-60px]">
            <div className="w-[60px] h-[60px] bg-white rounded-[16px] flex items-center justify-center mb-5 shadow-sm p-1">
              <div className="w-10 h-10 bg-[#e0e1db] rounded-[10px] flex items-center justify-center text-gray-600">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-bot">
                  <path d="M12 8V4H8"/>
                  <rect width="16" height="12" x="4" y="8" rx="2"/>
                  <path d="M2 14h2"/>
                  <path d="M20 14h2"/>
                  <path d="M15 13v2"/>
                  <path d="M9 13v2"/>
                </svg>
              </div>
            </div>
            <h2 className="text-gray-300 text-[15px] mb-6">Take actions with Github</h2>
            
            <div className="flex flex-col gap-3 w-full items-center">
              <button 
                onClick={() => submitPrompt('Summarize recent PR activity')}
                className="bg-[#2b2d31] hover:bg-[#383a40] text-gray-300 border border-gray-600/60 rounded-full py-2.5 px-5 text-[15px] text-center transition-colors shadow-sm"
              >
                Summarize recent PR activity
              </button>
              <button 
                onClick={() => submitPrompt('Create issues from TODO comments')}
                className="bg-[#2b2d31] hover:bg-[#383a40] text-gray-300 border border-gray-600/60 rounded-full py-2.5 px-5 text-[15px] text-center transition-colors shadow-sm"
              >
                Create issues from TODO comments
              </button>
              <button 
                onClick={() => submitPrompt('Review and provide PR feedback')}
                className="bg-[#2b2d31] hover:bg-[#383a40] text-gray-300 border border-gray-600/60 rounded-full py-2.5 px-5 text-[15px] text-center transition-colors shadow-sm"
              >
                Review and provide PR feedback
              </button>
            </div>
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
                      <div className="prose prose-invert prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:bg-[#1e1f22] prose-pre:rounded-md prose-code:text-gray-200 prose-strong:text-gray-100">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            if (item.kind === 'log' && item.entry) {
              return <ActionLogRow key={index} entry={item.entry} />;
            }

            return null;
          })
        )}

        {(runState === 'planning' || runState === 'running') && !streamingText && (
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

        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[88%] text-[15px] leading-relaxed text-gray-200 py-1">
              <p className="font-mono text-sm whitespace-pre-wrap text-gray-400">
                {streamingText.endsWith('}') || streamingText.endsWith(']') 
                  ? streamingText 
                  : streamingText + '...'}
              </p>
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
        <div className="relative">
          {showMenu && (
            <CommandMenu
              commands={filteredCommands}
              selectedIndex={safeMenuIndex}
              onSelect={selectCommand}
            />
          )}
          {mentionTrigger && (
            <MentionMenu
              items={mentionItems}
              selectedIndex={mentionItems.length === 0 ? 0 : mentionIndex % Math.max(1, mentionItems.length)}
              onSelect={insertMention}
            />
          )}
          <div className="bg-[#383a40] border border-gray-600/50 rounded-[20px] p-3 flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) =>
              handleInputChange(event.target.value, event.target.selectionStart ?? event.target.value.length)
            }
            onKeyDown={(event) => {
              if (mentionTrigger && mentionItems.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMentionIndex((index) => (index + 1) % mentionItems.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMentionIndex(
                    (index) => (index - 1 + mentionItems.length) % mentionItems.length,
                  );
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  insertMention(mentionItems[mentionIndex % mentionItems.length]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  dismissedTriggerRef.current = mentionTrigger.start;
                  setMentionTrigger(null);
                  setMentionItems([]);
                  return;
                }
              }
              if (showMenu) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMenuIndex((index) => (index + 1) % filteredCommands.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMenuIndex(
                    (index) => (index - 1 + filteredCommands.length) % filteredCommands.length,
                  );
                  return;
                }
                if (event.key === 'Tab') {
                  event.preventDefault();
                  selectCommand(filteredCommands[safeMenuIndex]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setInput('');
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (mentionTrigger && mentionItems.length > 0) {
                  insertMention(mentionItems[mentionIndex % mentionItems.length]);
                  return;
                }
                if (showMenu) {
                  selectCommand(filteredCommands[safeMenuIndex]);
                  return;
                }
                handleSend();
              }
            }}
            placeholder="Type / for commands"
            className="w-full min-h-[24px] overflow-y-auto bg-transparent border-none resize-none text-[15px] leading-6 text-gray-200 placeholder-gray-500 focus:outline-none"
            rows={1}
          />
          <div className="flex items-center justify-between mt-1">
            <button className="flex items-center gap-1.5 text-gray-400 hover:text-gray-300 active:scale-95 transition-all duration-150 text-[13px] px-1.5 py-1 rounded-md hover:bg-white/5 active:bg-white/10">
              <Hand size={14} />
              <span>Ask before acting</span>
              <ChevronDown size={14} />
            </button>

            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/5 active:bg-white/10 active:scale-90 transition-all duration-150">
                <Zap size={18} />
              </button>
              <button className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/5 active:bg-white/10 active:scale-90 transition-all duration-150">
                <Plus size={20} />
              </button>
              {runState === 'running' ? (
                <button onClick={handleStop} className="text-xs px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 active:bg-red-800 active:scale-95 transition-all duration-150 text-white">
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  aria-label="Send"
                  disabled={!input.trim() || runState !== 'idle'}
                  className={`p-1.5 rounded-full transition-all duration-150 ${
                    input.trim() && runState === 'idle'
                      ? 'bg-[#d97757] text-white hover:bg-[#e88868] active:bg-[#c76647] active:scale-90'
                      : 'bg-[#4a4c52] text-gray-500'
                  }`}
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
          </div>
        </div>
        <div className="text-center mt-3 text-[11px] text-gray-500">
          Claude is AI and can make mistakes. Please double-check responses.
        </div>
      </footer>
    </div>
  );
}

function actionToContentPayload(action: AgentAction): {
  action: string;
  targetId?: number;
  value?: string;
  direction?: 'up' | 'down';
} {
  switch (action.tool) {
    case 'click':
      return { action: 'click', targetId: action.targetId };
    case 'type':
      return { action: 'type', targetId: action.targetId, value: action.value };
    case 'scroll':
      return { action: 'scroll', direction: action.direction };
    case 'navigate':
      return { action: 'navigate', value: action.url };
    case 'finish':
      return { action: 'finish' };
  }
}

export default App;

import { useState, useEffect, useRef } from 'react';
import { Plus, ArrowUp, MessageSquarePlus, Zap, MoreVertical, Wand2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [config, setConfig] = useState({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load config & history
  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'baseUrl', 'model', 'chatHistory'], (res) => {
      if (res.apiKey) setConfig(prev => ({ ...prev, apiKey: res.apiKey as string }));
      if (res.baseUrl) setConfig(prev => ({ ...prev, baseUrl: res.baseUrl as string }));
      if (res.model) setConfig(prev => ({ ...prev, model: res.model as string }));
      if (res.chatHistory) setMessages(res.chatHistory as Message[]);
    });

    const messageListener = (msg: any) => {
      if (msg.type === "CONTEXT_MENU_SELECTION") {
        setInput(prev => prev + `\n\nContext:\n"${msg.text}"\n\n`);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') {
        setConfig(prev => ({
          ...prev,
          apiKey: changes.apiKey !== undefined ? (changes.apiKey.newValue as string) : prev.apiKey,
          baseUrl: changes.baseUrl !== undefined ? (changes.baseUrl.newValue as string) : prev.baseUrl,
          model: changes.model !== undefined ? (changes.model.newValue as string) : prev.model,
        }));
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  // Save history
  useEffect(() => {
    chrome.storage.local.set({ chatHistory: messages });
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getDOMTree = (): Promise<{dom: string, url: string, title: string}> => {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GET_DOM_TREE" }, (response) => {
            if (chrome.runtime.lastError) {
               // Ignore error, means content script isn't there (e.g. chrome:// tabs)
               resolve({ dom: 'Cannot read restricted page (like chrome://) or page is still loading.', url: tab.url || '', title: tab.title || '' });
               return;
            }
            if (response && response.dom) {
              resolve({ dom: response.dom.substring(0, 30000), url: response.url || tab.url || '', title: response.title || tab.title || '' });
            } else {
              resolve({ dom: 'No interactive elements found.', url: tab.url || '', title: tab.title || '' });
            }
          });
        } else {
          resolve({ dom: 'No active tab found.', url: '', title: '' });
        }
      });
    });
  };

  const getPageContext = (): Promise<string> => {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTENT" }, (response) => {
            if (chrome.runtime.lastError) {
               resolve(`URL: ${tab.url}\nTitle: ${tab.title}\n\n[Cannot extract text from restricted pages like chrome:// tabs]`);
               return;
            }
            if (response?.text) {
              resolve(`URL: ${tab.url}\nTitle: ${tab.title}\n\n${response.text.substring(0, 15000)}`);
            } else {
              resolve(`URL: ${tab.url}\nTitle: ${tab.title}\n\n[No text content found]`);
            }
          });
        } else {
          resolve('');
        }
      });
    });
  };

  const executeAction = (action: string, targetId?: string, value?: string): Promise<string> => {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "EXECUTE_ACTION", payload: { action, targetId, value } }, (response) => {
            resolve(response?.message || response?.error || "Action execution failed");
          });
        } else {
          resolve("No active tab found");
        }
      });
    });
  };

  const handleSend = async (textToSubmit?: string, isSystemAutoReply?: boolean) => {
    const finalInput = textToSubmit || input;
    if (!finalInput.trim() && !isSystemAutoReply) return;
    if (!config.apiKey) {
      alert("Please configure your API key in the extension options.");
      chrome.runtime.openOptionsPage();
      return;
    }

    setLoading(true);
    let currentMessages = [...messages];
    
    if (!isSystemAutoReply) {
       currentMessages.push({ role: 'user', content: finalInput } as Message);
       setMessages([...currentMessages]);
       if (!textToSubmit) setInput('');
    }

    // Agent mode preparation
    let systemPrompt: Message | null = null;
    if (isAgentMode) {
       const pageData = await getDOMTree();
       systemPrompt = { 
         role: 'system', 
         content: `You are a browser automation agent. You can view the current webpage and take actions.
Current URL: ${pageData.url}
Page Title: ${pageData.title}

INTERACTIVE ELEMENTS:
${pageData.dom}

If the user asks you to do something on the page (click, type, search, navigate), you must output ONLY a JSON block like this to execute an action:
\`\`\`json
{"action": "click", "targetId": "123"}
\`\`\`
Valid actions: click, type (requires "value"), navigate (requires "value" as URL), scroll.
If you do not need to take an action, reply normally.`
       };
    }

    const messagesToSend = systemPrompt ? [systemPrompt, ...currentMessages] : currentMessages;

    try {
      const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: messagesToSend.map(m => ({ role: m.role, content: m.content })),
          stream: true
        })
      });

      if (!response.ok) {
        let errorMsg = `API Error: ${response.status}`;
        try {
          const errorText = await response.text();
          try {
            const errorData = JSON.parse(errorText);
            errorMsg += ` - ${errorData?.error?.message || JSON.stringify(errorData)}`;
          } catch {
            if (errorText) errorMsg += ` - ${errorText}`;
          }
        } catch (e) {}
        throw new Error(errorMsg);
      }

      setLoading(false);
      let streamedResponse = '';
      setMessages([...currentMessages, { role: 'assistant', content: '' }]);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') break;
              
              try {
                const data = JSON.parse(dataStr);
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  streamedResponse += content;
                  setMessages([...currentMessages, { role: 'assistant', content: streamedResponse }]);
                }
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      }

      // Check if AI output an action
      if (isAgentMode) {
        const jsonMatch = streamedResponse.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          try {
            const actionJson = JSON.parse(jsonMatch[1]);
            if (actionJson.action) {
              const result = await executeAction(actionJson.action, actionJson.targetId, actionJson.value);
              currentMessages.push({ role: 'assistant', content: streamedResponse });
              currentMessages.push({ role: 'system', content: `[Action Result]: ${result}\nIf task is done, summarize. If not, output next JSON action.` });
              setMessages([...currentMessages]);
              // Wait briefly before next action
              setTimeout(() => {
                handleSend(undefined, true);
              }, 500);
              return; // return early so we don't duplicate state update
            }
          } catch(e) {
            console.error("Action parse failed", e);
          }
        }
      }
      
      // Final save for non-action or failed action parsing
      currentMessages.push({ role: 'assistant', content: streamedResponse });
      setMessages([...currentMessages]);
      
    } catch (error: any) {
      console.error(error);
      setMessages([...currentMessages, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleReadPage = async () => {
    const pageText = await getPageContext();
    if (pageText) {
      handleSend(`Please read this page context and summarize it or help me with it:\n\n${pageText}`);
    } else {
      alert("Could not extract page content.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearHistory = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen bg-[#2b2d31] text-gray-200 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#2b2d31]">
        <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded-md transition-colors" onClick={() => chrome.runtime.openOptionsPage()}>
          <span className="text-[15px] font-medium">{config.model || 'Model'}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="m6 9 6 6 6-6"/></svg>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <button className="hover:text-gray-200 transition-colors" title="Read Page Context" onClick={handleReadPage}>
            <Zap size={18} />
          </button>
          <button className="hover:text-gray-200 transition-colors" title="New Chat" onClick={clearHistory}>
            <MessageSquarePlus size={18} />
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()} className="hover:text-gray-200 transition-colors" title="Settings">
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      {/* Chat History */}
      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto mt-[-40px]">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-sm overflow-hidden">
              <div className="text-3xl">👋</div>
            </div>
            <h2 className="text-gray-300 text-[15px] mb-6">Take actions with Aiside</h2>
            
            <div className="w-full flex flex-col gap-3">
              <button onClick={() => handleSend("Summarize recent activity")} className="bg-transparent border border-gray-600 hover:bg-white/5 text-gray-200 text-sm py-3 px-4 rounded-full transition-colors text-center w-full">
                Summarize recent activity
              </button>
              <button onClick={() => handleSend("Explain the current page")} className="bg-transparent border border-gray-600 hover:bg-white/5 text-gray-200 text-sm py-3 px-4 rounded-full transition-colors text-center w-full">
                Explain the current page
              </button>
              <button onClick={handleReadPage} className="bg-transparent border border-gray-600 hover:bg-white/5 text-gray-200 text-sm py-3 px-4 rounded-full transition-colors text-center w-full">
                Read and provide feedback
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] text-[15px] leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-[#383a40] text-gray-100 rounded-2xl px-4 py-3' 
                  : 'text-gray-200 py-1'
              }`}>
                <div className={msg.role === 'user' ? '' : 'prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#1e1f22] prose-pre:border prose-pre:border-gray-700'}>
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="text-gray-400 py-2 flex items-center gap-2 text-sm">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-4 pt-2">
        <div className="bg-[#383a40] border border-gray-600/50 rounded-2xl p-3 flex flex-col gap-2 focus-within:border-gray-500 transition-colors shadow-sm">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Aiside..."
            className="w-full max-h-48 min-h-[24px] bg-transparent border-none resize-none text-[15px] text-gray-200 placeholder-gray-500 focus:outline-none"
            rows={1}
          />
          
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-3 text-gray-400">
              <button 
                onClick={() => setIsAgentMode(!isAgentMode)}
                className={`flex items-center gap-1 transition-colors text-xs font-medium ${isAgentMode ? 'text-blue-400 hover:text-blue-300' : 'hover:text-gray-200'}`} 
                title={isAgentMode ? "Agent Mode: ON (Will act on page)" : "Agent Mode: OFF (Chat only)"}
              >
                <span className={`w-3 h-3 border rounded-sm flex items-center justify-center text-[8px] ${isAgentMode ? 'border-blue-400 bg-blue-400/20 text-blue-400' : 'border-gray-400'}`}>
                  {isAgentMode ? '⚡' : '✋'}
                </span>
                {isAgentMode ? 'Auto Action' : 'Ask before acting'}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              
              <button className="hover:text-gray-200 transition-colors ml-2" title="Format/Magic">
                <Wand2 size={16} />
              </button>
              <button className="hover:text-gray-200 transition-colors" title="Add attachment">
                <Plus size={18} />
              </button>
            </div>
            
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${
                input.trim() && !loading 
                  ? 'bg-[#d97757] text-white hover:bg-[#c96a4a]' 
                  : 'bg-[#4a4c52] text-gray-500'
              }`}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <div className="text-center mt-3 text-[11px] text-gray-500">
          Aiside is AI and can make mistakes. Please double-check responses.
        </div>
      </footer>
    </div>
  );
}

export default App;
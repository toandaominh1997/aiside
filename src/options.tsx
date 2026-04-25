import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const Options = () => {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['apiKey', 'baseUrl', 'model'], (result) => {
      if (result.apiKey) setApiKey(result.apiKey as string);
      if (result.baseUrl) setBaseUrl(result.baseUrl as string);
      if (result.model) setModel(result.model as string);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({ apiKey, baseUrl, model }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">Aiside Configuration</h1>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input 
              id="apiKey"
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="sk-..."
            />
          </div>

          <div>
            <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
            <input 
              id="baseUrl"
              type="url" 
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-1 text-xs text-gray-500">For example: https://api.openai.com/v1 or http://localhost:11434/v1</p>
          </div>

          <div>
            <label htmlFor="modelName" className="block text-sm font-medium text-gray-700 mb-1">Model Name</label>
            <input 
              id="modelName"
              type="text" 
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="gpt-4o"
            />
          </div>

          <button 
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Options;

// Render logic (only executed when loaded in browser, not test)
if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<Options />);
  }
}
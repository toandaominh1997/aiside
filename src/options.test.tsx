import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Options from './options'; // We'll need to export default or export from options.tsx

describe('Options component', () => {
  beforeEach(() => {
    // Reset the chrome.storage.local.get mock
    vi.mocked(chrome.storage.local.get).mockImplementation((keys, callback) => {
      callback({
        apiKey: 'test-api-key',
        baseUrl: 'https://test.api.com',
        model: 'test-model'
      });
    });
  });

  it('renders the options form correctly', async () => {
    render(<Options />);
    
    expect(screen.getByText('Aiside Configuration')).toBeInTheDocument();
    
    // Check initial values are loaded from chrome.storage
    await waitFor(() => {
      expect(screen.getByDisplayValue('test-api-key')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://test.api.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('test-model')).toBeInTheDocument();
    });
  });

  it('allows user to change values and save them', async () => {
    const user = userEvent.setup();
    render(<Options />);
    
    // Wait for initial load
    await waitFor(() => screen.getByDisplayValue('test-api-key'));
    
    const apiKeyInput = screen.getByLabelText('API Key');
    const baseUrlInput = screen.getByLabelText('Base URL');
    const modelInput = screen.getByLabelText('Model Name');
    const saveButton = screen.getByRole('button', { name: 'Save Settings' });

    // Change API Key
    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, 'new-api-key');
    
    // Change Base URL
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, 'https://new.api.com');
    
    // Change Model
    await user.clear(modelInput);
    await user.type(modelInput, 'new-model');

    // Setup mock for set
    vi.mocked(chrome.storage.local.set).mockImplementation((data, callback) => {
      if (callback) callback();
    });

    // Click save
    await user.click(saveButton);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { apiKey: 'new-api-key', baseUrl: 'https://new.api.com', model: 'new-model' },
      expect.any(Function)
    );

    // Verify "Saved!" state
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
    
    // Verify it reverts to "Save Settings" (using fake timers or just wait for it... vitest fake timers are better)
    // Actually, let's just let it be, or we can use vi.useFakeTimers()
  });
});

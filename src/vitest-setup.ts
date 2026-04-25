import '@testing-library/jest-dom';
import { vi, beforeAll, afterEach } from 'vitest';

// Mock chrome API
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    lastError: undefined as undefined | { message: string },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    captureVisibleTab: vi.fn(),
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
};

beforeAll(() => {
  (globalThis as { chrome: typeof mockChrome }).chrome = mockChrome;
});

afterEach(() => {
  vi.clearAllMocks();
});

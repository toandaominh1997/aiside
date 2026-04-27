import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionLogRow } from './ActionLogRow';
import type { ActionLogEntry } from '../agent/loop';

const ok: ActionLogEntry = {
  id: '1',
  ts: 0,
  tool: 'click',
  args: { targetId: 7, rationale: 'go' },
  rationale: 'go',
  ok: true,
  message: 'Clicked element 7',
  durationMs: 12,
};

const fail: ActionLogEntry = {
  id: '2',
  ts: 0,
  tool: 'type',
  args: { targetId: 9, value: 'x', rationale: 'r' },
  rationale: 'r',
  ok: false,
  message: 'Element with id 9 not found',
  durationMs: 5,
};

describe('ActionLogRow', () => {
  it('shows success summary collapsed by default', () => {
    render(<ActionLogRow entry={ok} />);
    expect(screen.getByText(/click/i)).toBeInTheDocument();
    expect(screen.queryByText(/Clicked element 7/)).toBeNull();
  });

  it('expands on click and shows message', () => {
    render(<ActionLogRow entry={ok} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Clicked element 7/)).toBeInTheDocument();
  });

  it('renders failure with error styling', () => {
    render(<ActionLogRow entry={fail} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Element with id 9 not found/)).toBeInTheDocument();
  });

  it('summarizes power tools and mention targets', () => {
    const entries: ActionLogEntry[] = [
      { ...ok, id: 'mention', tool: 'click', args: { target: '@button-submit-0', rationale: 'r' } },
      { ...ok, id: 'wait', tool: 'wait', args: { ms: 500, rationale: 'r' } },
      { ...ok, id: 'observe', tool: 'observe', args: { rationale: 'r' } },
      { ...ok, id: 'recall', tool: 'recall', args: { rationale: 'r' } },
    ];

    for (const entry of entries) render(<ActionLogRow entry={entry} />);

    expect(screen.getByText('@button-submit-0')).toBeInTheDocument();
    expect(screen.getByText('500ms')).toBeInTheDocument();
    expect(screen.getByText('page snapshot')).toBeInTheDocument();
    expect(screen.getByText('all memory')).toBeInTheDocument();
  });
});

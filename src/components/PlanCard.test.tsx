import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanCard } from './PlanCard';

const plan = {
  summary: 'Do a thing',
  steps: ['One', 'Two'],
  sites: ['https://example.com'],
};

describe('PlanCard', () => {
  it('renders summary, sites, and steps', () => {
    render(<PlanCard plan={plan} modelLabel="Opus 4.7" onApprove={vi.fn()} onMakeChanges={vi.fn()} />);
    expect(screen.getByText('Do a thing')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getByText(/Opus 4\.7's plan/)).toBeInTheDocument();
  });

  it('fires onApprove when Approve plan is clicked', () => {
    const onApprove = vi.fn();
    render(<PlanCard plan={plan} modelLabel="m" onApprove={onApprove} onMakeChanges={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve plan/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it('fires onMakeChanges when Make changes is clicked', () => {
    const onMakeChanges = vi.fn();
    render(<PlanCard plan={plan} modelLabel="m" onApprove={vi.fn()} onMakeChanges={onMakeChanges} />);
    fireEvent.click(screen.getByRole('button', { name: /Make changes/i }));
    expect(onMakeChanges).toHaveBeenCalled();
  });

  it('Enter key approves, Cmd+Enter edits', () => {
    const onApprove = vi.fn();
    const onMakeChanges = vi.fn();
    render(<PlanCard plan={plan} modelLabel="m" onApprove={onApprove} onMakeChanges={onMakeChanges} />);
    const card = screen.getByTestId('plan-card');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onApprove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Enter', metaKey: true });
    expect(onMakeChanges).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when disabled', () => {
    render(<PlanCard plan={plan} modelLabel="m" onApprove={vi.fn()} onMakeChanges={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: /Approve plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Make changes/i })).toBeDisabled();
  });
});

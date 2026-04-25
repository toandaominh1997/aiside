import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanCard } from './PlanCard';
import type { Plan } from '../providers/types';

const plan: Plan = {
  summary: 'List all books',
  steps: ['Read home', 'Navigate', 'Extract'],
  sites: ['https://learning.oreilly.com'],
};

describe('PlanCard', () => {
  it('renders sites and steps', () => {
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={() => {}} />);
    expect(screen.getByText('https://learning.oreilly.com')).toBeInTheDocument();
    expect(screen.getByText('Read home')).toBeInTheDocument();
    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Extract')).toBeInTheDocument();
  });

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = vi.fn();
    render(<PlanCard plan={plan} onApprove={onApprove} onMakeChanges={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /approve plan/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onMakeChanges when Make changes button is clicked', () => {
    const onChange = vi.fn();
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /make changes/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons when disabled=true', () => {
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={() => {}} disabled />);
    expect(screen.getByRole('button', { name: /approve plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /make changes/i })).toBeDisabled();
  });
});

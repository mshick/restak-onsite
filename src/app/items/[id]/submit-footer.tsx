'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { submitReview } from './actions';

export interface SubmitFooterProps {
  itemId: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
  currentMarkdown?: string;
}

export function SubmitFooter({
  itemId,
  totalDiscrepancies,
  includedCount,
  hasReconciled,
  currentMarkdown,
}: SubmitFooterProps) {
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(() => {
      submitReview(itemId, currentMarkdown);
    });
  }

  return (
    <footer className="sticky bottom-0 -mx-8 mt-6 flex items-center justify-between border-t bg-background/95 px-8 py-3 text-sm backdrop-blur">
      <span className="text-muted-foreground">
        {hasReconciled
          ? `${totalDiscrepancies} discrepancies · ${includedCount} to include in email`
          : 'Run reconcile to begin.'}
      </span>
      <Button onClick={onSubmit} disabled={!hasReconciled || pending}>
        {pending ? 'Submitting…' : 'Submit & mark reviewed'}
      </Button>
    </footer>
  );
}

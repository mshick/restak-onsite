'use client';

import { Button } from '@/components/ui/button';

export interface SubmitFooterProps {
  itemId: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
  currentMarkdown?: string;
}

export function SubmitFooter({
  totalDiscrepancies,
  includedCount,
  hasReconciled,
}: SubmitFooterProps) {
  return (
    <footer className="sticky bottom-0 -mx-8 mt-6 flex items-center justify-between border-t bg-background/95 px-8 py-3 text-sm backdrop-blur">
      <span className="text-muted-foreground">
        {hasReconciled
          ? `${totalDiscrepancies} discrepancies · ${includedCount} to include in email`
          : 'Run reconcile to begin.'}
      </span>
      <Button disabled>Submit &amp; mark reviewed</Button>
    </footer>
  );
}

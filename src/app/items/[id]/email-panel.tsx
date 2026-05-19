'use client';

import type { Discrepancy } from '@/lib/reconcile';

export interface EmailPanelProps {
  itemId: string;
  initialMarkdown: string | null;
  discrepancies: Discrepancy[];
  // The page passes a pre-rendered template string so the panel doesn't need
  // to know about row-shaping. Task 12 wires this up properly.
  templatePreview: string;
}

export function EmailPanel({ initialMarkdown, templatePreview }: EmailPanelProps) {
  return (
    <aside className="rounded-md border p-3 text-xs text-muted-foreground">
      <p className="mb-2 font-medium text-foreground">Email (preview)</p>
      <pre className="whitespace-pre-wrap font-mono">
        {initialMarkdown ?? templatePreview}
      </pre>
    </aside>
  );
}

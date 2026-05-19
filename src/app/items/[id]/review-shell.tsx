'use client';

import { useState } from 'react';
import { EmailPanel } from './email-panel';
import { SubmitFooter } from './submit-footer';

export interface ReviewShellProps {
  itemId: string;
  initialMarkdown: string | null;
  templatePreview: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
  children: React.ReactNode; // the discrepancy cards
}

export function ReviewShell({
  itemId,
  initialMarkdown,
  templatePreview,
  totalDiscrepancies,
  includedCount,
  hasReconciled,
  children,
}: ReviewShellProps) {
  const [currentMarkdown, setCurrentMarkdown] = useState(initialMarkdown ?? templatePreview);

  return (
    <>
      <section className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
        {children}
        <EmailPanel
          itemId={itemId}
          initialMarkdown={initialMarkdown}
          templatePreview={templatePreview}
          onMarkdownChange={setCurrentMarkdown}
        />
      </section>
      <SubmitFooter
        itemId={itemId}
        totalDiscrepancies={totalDiscrepancies}
        includedCount={includedCount}
        hasReconciled={hasReconciled}
        currentMarkdown={currentMarkdown}
      />
    </>
  );
}

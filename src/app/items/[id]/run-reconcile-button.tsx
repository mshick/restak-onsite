'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

export function RunReconcileButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={run} disabled={pending}>
        {pending ? 'Reconciling…' : 'Run reconcile'}
      </Button>
      {error && <span className="text-xs text-destructive">Error: {error}</span>}
    </div>
  );
}

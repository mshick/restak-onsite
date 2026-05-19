'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyEmailButton({ markdown }: { markdown: string | null }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  if (!markdown) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(markdown);
          setState('copied');
          setTimeout(() => setState('idle'), 1500);
        } catch {
          setState('error');
          setTimeout(() => setState('idle'), 2000);
        }
      }}
    >
      {state === 'copied' ? 'Copied!' : state === 'error' ? 'Copy failed' : 'Copy email'}
    </Button>
  );
}

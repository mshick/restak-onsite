'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateEmail } from './actions';

export interface EmailPanelProps {
  itemId: string;
  initialMarkdown: string | null;
  templatePreview: string;
  /**
   * Called whenever the visible markdown changes (initial load, after
   * generate, after edit). The parent (SubmitFooter, via context or
   * window state) reads from here on submit.
   */
  onMarkdownChange?: (markdown: string, source: 'template' | 'llm' | 'edited') => void;
}

export function EmailPanel({
  itemId,
  initialMarkdown,
  templatePreview,
  onMarkdownChange,
}: EmailPanelProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown ?? templatePreview);
  const [source, setSource] = useState<'template' | 'llm' | 'edited'>(
    initialMarkdown ? 'llm' : 'template',
  );
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  function announce(next: string, nextSource: 'template' | 'llm' | 'edited') {
    setMarkdown(next);
    setSource(nextSource);
    onMarkdownChange?.(next, nextSource);
  }

  function onGenerate() {
    startTransition(async () => {
      const result = await generateEmail(itemId);
      announce(result.markdown, result.source);
    });
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      /* noop */
    }
  }

  return (
    <aside className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Email to carrier</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={pending}>
            {pending
              ? 'Drafting…'
              : initialMarkdown || source !== 'template'
                ? 'Regenerate'
                : 'Generate email'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Preview' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopy}>
            {copyState === 'copied' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
      {source === 'template' && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
          Template fallback — no API key or API error. Click Generate to draft via LLM.
        </span>
      )}
      {editing ? (
        <textarea
          className="min-h-[400px] w-full rounded border bg-background p-2 font-mono text-xs"
          value={markdown}
          onChange={(e) => announce(e.target.value, 'edited')}
        />
      ) : (
        <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-xs">
          {markdown}
        </pre>
      )}
    </aside>
  );
}

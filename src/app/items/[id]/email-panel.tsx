'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateEmail } from './actions';

export type EmailSource = 'preview' | 'llm-fallback' | 'llm' | 'edited';

export interface EmailPanelProps {
  itemId: string;
  initialMarkdown: string | null;
  templatePreview: string;
  /**
   * Called whenever the effective markdown changes (initial load, after
   * generate, after edit, or after a server revalidation updates the
   * template preview). The parent reads this on submit.
   */
  onMarkdownChange?: (markdown: string, source: EmailSource) => void;
}

interface Override {
  markdown: string;
  source: Exclude<EmailSource, 'preview'>;
}

export function EmailPanel({
  itemId,
  initialMarkdown,
  templatePreview,
  onMarkdownChange,
}: EmailPanelProps) {
  // `override` holds reviewer-driven content: a Generate result, an inline
  // edit, or the persisted email on a re-loaded row. When it's null the
  // panel shows the live `templatePreview` prop — which updates whenever
  // the server revalidates after a flag/rationale change.
  const [override, setOverride] = useState<Override | null>(() =>
    initialMarkdown ? { markdown: initialMarkdown, source: 'llm' } : null,
  );
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const markdown = override?.markdown ?? templatePreview;
  const source: EmailSource = override?.source ?? 'preview';

  // Notify the parent whenever the effective markdown changes — including
  // server-driven updates to templatePreview while no override is set.
  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (markdown !== lastNotified.current) {
      lastNotified.current = markdown;
      onMarkdownChange?.(markdown, source);
    }
  }, [markdown, source, onMarkdownChange]);

  function onGenerate() {
    startTransition(async () => {
      const result = await generateEmail(itemId);
      setOverride({
        markdown: result.markdown,
        source: result.source === 'llm' ? 'llm' : 'llm-fallback',
      });
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
            {pending ? 'Drafting…' : override ? 'Regenerate' : 'Generate email'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Preview' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopy}>
            {copyState === 'copied' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
      {source === 'preview' && (
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          Live preview from current flags + rationales. Click Generate to draft via LLM.
        </span>
      )}
      {source === 'llm-fallback' && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
          Template fallback — LLM call failed or no API key. Submit will use this text.
        </span>
      )}
      {editing ? (
        <textarea
          className="min-h-[400px] w-full rounded border bg-background p-2 font-mono text-xs"
          value={markdown}
          onChange={(e) => setOverride({ markdown: e.target.value, source: 'edited' })}
        />
      ) : (
        <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-xs">
          {markdown}
        </pre>
      )}
    </aside>
  );
}

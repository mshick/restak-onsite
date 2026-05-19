'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'success'; reference: string; bound: boolean }
  | { kind: 'error'; message: string };

export function UploadDocument() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setStatus({ kind: 'error', message: 'Pick a PDF first.' });
      return;
    }

    setStatus({ kind: 'uploading', filename: file.name });
    const formData = new FormData();
    formData.append('file', file);

    let res: Response;
    try {
      res = await fetch('/api/upload', { method: 'POST', body: formData });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error.',
      });
      return;
    }

    const body = (await res.json().catch(() => null)) as
      | { reference?: string; bound?: boolean; error?: string }
      | null;

    if (!res.ok || !body) {
      setStatus({
        kind: 'error',
        message: body?.error ?? `Upload failed (HTTP ${res.status}).`,
      });
      return;
    }

    setStatus({
      kind: 'success',
      reference: body.reference ?? '',
      bound: body.bound ?? false,
    });
    if (inputRef.current) inputRef.current.value = '';
    startTransition(() => router.refresh());
  }

  const busy = status.kind === 'uploading' || isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-dashed p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <label htmlFor="upload-file" className="text-sm font-medium">
            Upload a carrier PDF
          </label>
          <span className="text-xs text-muted-foreground">
            Extracts fields, matches it to an existing policy, and adds it to the queue.
          </span>
        </div>
        <input
          ref={inputRef}
          id="upload-file"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Processing…' : 'Upload'}
        </Button>
      </div>

      {status.kind === 'uploading' && (
        <p className="text-xs text-muted-foreground">
          Extracting <span className="font-mono">{status.filename}</span> — this calls the LLM, give
          it ~10 seconds.
        </p>
      )}
      {status.kind === 'success' && (
        <p className="text-xs text-emerald-700">
          Added <span className="font-mono">{status.reference}</span>
          {status.bound ? '.' : ' (no policy match — open the item to assign one).'}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="text-xs text-red-700">Could not upload: {status.message}</p>
      )}
    </form>
  );
}

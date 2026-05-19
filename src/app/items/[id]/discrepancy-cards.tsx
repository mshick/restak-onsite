'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { editRationale, toggleFlag } from './actions';
import type { Discrepancy, FieldDiscrepancy, NarrativeDiscrepancy } from '@/lib/reconcile';

const TIER_TONE: Record<string, string> = {
  out_of_distribution: 'border-red-300 bg-red-50',
  material: 'border-amber-300 bg-amber-50',
  ambiguous: 'border-violet-300 bg-violet-50',
  auto_resolved: 'border-emerald-300 bg-emerald-50',
  cosmetic: 'border-slate-200 bg-slate-50',
};

const NEEDS_REVIEW_TIERS = new Set(['material', 'ambiguous', 'out_of_distribution']);

function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay: number) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay],
  );
}

export interface DiscrepancyCardsProps {
  itemId: string;
  discrepancies: Discrepancy[];
}

export function DiscrepancyCards({ itemId, discrepancies }: DiscrepancyCardsProps) {
  const needsReview = discrepancies.filter((d) => NEEDS_REVIEW_TIERS.has(d.tier));
  const handled = discrepancies.filter((d) => !NEEDS_REVIEW_TIERS.has(d.tier));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Needs review{' '}
          <span className="text-xs font-normal text-muted-foreground">
            ({needsReview.length})
          </span>
        </h2>
        {discrepancies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Not yet compared. Click <strong>Run reconcile</strong> to populate.
          </p>
        )}
        {needsReview.map((d) =>
          d.kind === 'field' ? (
            <FieldFindingCard key={d.id} d={d} itemId={itemId} />
          ) : (
            <NarrativeFindingCard key={d.id} d={d} itemId={itemId} />
          ),
        )}
      </section>
      {handled.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Handled automatically ({handled.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {handled.map((d) =>
              d.kind === 'field' ? (
                <FieldFindingCard key={d.id} d={d} itemId={itemId} />
              ) : (
                <NarrativeFindingCard key={d.id} d={d} itemId={itemId} />
              ),
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function CardControls({
  itemId,
  discrepancy,
}: {
  itemId: string;
  discrepancy: Discrepancy;
}) {
  const [flag, setFlag] = useState(discrepancy.flag_state);
  const [rationale, setRationale] = useState(discrepancy.final_rationale);
  const [, startTransition] = useTransition();

  const debouncedSave = useDebouncedCallback((next: string) => {
    startTransition(() => {
      editRationale(itemId, discrepancy.id, next);
    });
  }, 500);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={flag === 'include'}
          onChange={(e) => {
            const next = e.target.checked ? 'include' : 'exclude';
            setFlag(next);
            startTransition(() => {
              toggleFlag(itemId, discrepancy.id, next);
            });
          }}
        />
        Include in email to carrier
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Rationale (carrier-facing)</span>
        <textarea
          className="min-h-[64px] rounded border bg-background p-2 text-sm font-normal"
          value={rationale}
          onChange={(e) => {
            setRationale(e.target.value);
            debouncedSave(e.target.value);
          }}
        />
      </label>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString();
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  return JSON.stringify(v);
}

function FieldFindingCard({ d, itemId }: { d: FieldDiscrepancy; itemId: string }) {
  return (
    <article className={`rounded-md border p-3 ${TIER_TONE[d.tier] ?? ''}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{d.field}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{d.tier}</span>
        <span className="text-xs text-muted-foreground">
          via {d.source}
          {typeof d.confidence === 'number' && ` · ${Math.round(d.confidence * 100)}%`}
          {typeof d.evidence?.extraction_confidence === 'number' &&
            ` · extracted @ ${Math.round(d.evidence.extraction_confidence * 100)}%`}
        </span>
      </header>
      <p className="mt-1 text-sm">{d.summary}</p>
      {d.detail && <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>}
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">SOR:</span> {formatValue(d.system_value)}
        </div>
        <div>
          <span className="text-muted-foreground">Extracted:</span> {formatValue(d.extracted_value)}
        </div>
      </div>
      <CardControls itemId={itemId} discrepancy={d} />
    </article>
  );
}

function NarrativeFindingCard({ d, itemId }: { d: NarrativeDiscrepancy; itemId: string }) {
  return (
    <article className={`rounded-md border p-3 ${TIER_TONE[d.tier] ?? ''}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase">{d.section}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{d.tier}</span>
        <span className="text-xs text-muted-foreground">
          narrative · via llm
          {typeof d.page === 'number' && ` · p${d.page}`}
          {typeof d.confidence === 'number' && ` · ${Math.round(d.confidence * 100)}%`}
        </span>
      </header>
      <p className="mt-1 text-sm font-medium">{d.summary}</p>
      {d.detail && <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>}
      <blockquote className="mt-2 border-l-2 border-current pl-2 text-xs italic">
        &ldquo;{d.excerpt}&rdquo;
      </blockquote>
      <CardControls itemId={itemId} discrepancy={d} />
    </article>
  );
}

'use client';

import { Button } from '@/components/ui/button';
import type { Discrepancy, FieldDiscrepancy, NarrativeDiscrepancy } from '@/lib/reconcile';

const TIER_TONE: Record<string, string> = {
  out_of_distribution: 'border-red-300 bg-red-50',
  material: 'border-amber-300 bg-amber-50',
  ambiguous: 'border-violet-300 bg-violet-50',
  auto_resolved: 'border-emerald-300 bg-emerald-50',
  cosmetic: 'border-slate-200 bg-slate-50',
};

export interface DiscrepancyCardsProps {
  itemId: string;
  discrepancies: Discrepancy[];
}

export function DiscrepancyCards({ itemId: _itemId, discrepancies }: DiscrepancyCardsProps) {
  const fieldFindings = discrepancies.filter(
    (d): d is FieldDiscrepancy => d.kind === 'field',
  );
  const narrativeFindings = discrepancies.filter(
    (d): d is NarrativeDiscrepancy => d.kind === 'narrative',
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Field findings{' '}
          <span className="text-xs font-normal text-muted-foreground">
            ({fieldFindings.length})
          </span>
        </h2>
        {discrepancies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Not yet compared. Click <strong>Run reconcile</strong> to populate.
          </p>
        )}
        {fieldFindings.map((d) => (
          <FieldFindingCard key={d.id} d={d} />
        ))}
      </section>
      {narrativeFindings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            Narrative findings{' '}
            <span className="text-xs font-normal text-muted-foreground">
              ({narrativeFindings.length}) — LLM-only
            </span>
          </h2>
          {narrativeFindings.map((d) => (
            <NarrativeFindingCard key={d.id} d={d} />
          ))}
        </section>
      )}
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

function FieldFindingCard({ d }: { d: FieldDiscrepancy }) {
  return (
    <article className={`rounded-md border p-3 ${TIER_TONE[d.tier] ?? ''}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{d.field}</span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{d.tier}</span>
          <span className="text-xs text-muted-foreground">
            via {d.source}
            {typeof d.confidence === 'number' && ` · ${Math.round(d.confidence * 100)}%`}
            {typeof d.evidence?.extraction_confidence === 'number' &&
              ` · extracted @ ${Math.round(d.evidence.extraction_confidence * 100)}%`}
          </span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled>
            Reject
          </Button>
          <Button size="sm" variant="ghost" disabled>
            Escalate
          </Button>
        </div>
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
    </article>
  );
}

function NarrativeFindingCard({ d }: { d: NarrativeDiscrepancy }) {
  return (
    <article className={`rounded-md border p-3 ${TIER_TONE[d.tier] ?? ''}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase">{d.section}</span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{d.tier}</span>
          <span className="text-xs text-muted-foreground">
            narrative · via llm
            {typeof d.page === 'number' && ` · p${d.page}`}
            {typeof d.confidence === 'number' && ` · ${Math.round(d.confidence * 100)}%`}
          </span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled>
            Escalate
          </Button>
        </div>
      </header>
      <p className="mt-1 text-sm font-medium">{d.summary}</p>
      {d.detail && <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>}
      <blockquote className="mt-2 border-l-2 border-current pl-2 text-xs italic">
        &ldquo;{d.excerpt}&rdquo;
      </blockquote>
    </article>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type {
  Discrepancy,
  ExtractedDocument,
  ExtractionField,
  SystemOfRecord,
  UnparsedSection,
} from '@/lib/reconcile';
import { createClient } from '@/lib/supabase/server';
import { RunReconcileButton } from './run-reconcile-button';

export const dynamic = 'force-dynamic';

const TIER_TONE: Record<string, string> = {
  out_of_distribution: 'border-red-300 bg-red-50',
  material: 'border-amber-300 bg-amber-50',
  ambiguous: 'border-violet-300 bg-violet-50',
  auto_resolved: 'border-emerald-300 bg-emerald-50',
  cosmetic: 'border-slate-200 bg-slate-50',
};

export default async function ItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: item } = await supabase
    .from('reconciliation_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!item) notFound();

  // jsonb columns come back as `Json`; the writers guarantee the shape.
  const sor = (item.system_of_record ?? {}) as unknown as SystemOfRecord;
  const ext = (item.extracted ?? { fields: {} }) as unknown as ExtractedDocument;
  const discrepancies = (item.discrepancies ?? []) as unknown as Discrepancy[];

  const fieldNames = [...new Set([...Object.keys(sor), ...Object.keys(ext.fields ?? {})])];
  const narrativeFindings = discrepancies.filter((d) => d.kind === 'narrative');
  const fieldFindings = discrepancies.filter((d) => d.kind === 'field');

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Back to queue
          </Link>
          <h1 className="font-mono text-xl font-semibold">{item.reference}</h1>
          <span className="text-xs uppercase text-muted-foreground">
            {item.doc_type}
            {ext.source?.filename ? ` · ${ext.source.filename}` : null}
            {typeof ext.source?.pages === 'number' ? ` · ${ext.source.pages}p` : null}
          </span>
        </div>
        <RunReconcileButton itemId={item.id} />
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
        <div className="rounded-md border p-3">
          <h2 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            System of record
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-sm">
            {fieldNames.map((f) => (
              <SorRow key={`s-${f}`} field={f} value={sor[f]} />
            ))}
          </dl>
        </div>

        <div className="rounded-md border p-3">
          <h2 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Extracted from document
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            {fieldNames.map((f) => (
              <ExtractedRow key={`e-${f}`} field={f} extracted={ext.fields?.[f]} />
            ))}
          </dl>
        </div>
      </section>

      {(ext.unparsed_sections?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">
            Unparsed sections ({ext.unparsed_sections?.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Free-text the extractor could not classify. The rules pass cannot read this — the LLM
            scans it for hidden coverage changes.
          </p>
          {ext.unparsed_sections?.map((s) => (
            <UnparsedRow key={`u-${s.label}-${s.page ?? 0}`} section={s} />
          ))}
        </section>
      )}

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
    </main>
  );
}

function SorRow({ field, value }: { field: string; value: unknown }) {
  return (
    <>
      <dt className="font-mono text-xs text-muted-foreground">{field}</dt>
      <dd className="break-words text-sm">{formatValue(value)}</dd>
    </>
  );
}

function ExtractedRow({
  field,
  extracted,
}: {
  field: string;
  extracted: ExtractionField | undefined;
}) {
  if (!extracted) {
    return (
      <div className="flex flex-col gap-0.5 border-l-2 border-dashed border-muted pl-2">
        <span className="font-mono text-xs text-muted-foreground">{field}</span>
        <span className="text-sm italic text-muted-foreground">— not extracted —</span>
      </div>
    );
  }
  const conf = extracted.confidence;
  const lowConf = typeof conf === 'number' && conf < 0.7;
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-muted pl-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{field}</span>
        {typeof conf === 'number' && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              lowConf ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-900'
            }`}
            title={`confidence ${conf.toFixed(2)}`}
          >
            {Math.round(conf * 100)}%
          </span>
        )}
      </div>
      <span className="break-words text-sm">{formatValue(extracted.value)}</span>
      {extracted.raw_text && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            raw_text{typeof extracted.page === 'number' ? ` · p${extracted.page}` : ''}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{extracted.raw_text}</pre>
        </details>
      )}
    </div>
  );
}

function UnparsedRow({ section }: { section: UnparsedSection }) {
  return (
    <details className="rounded-md border bg-muted/30 p-3 text-sm">
      <summary className="cursor-pointer font-mono text-xs uppercase">
        {section.label}
        {typeof section.page === 'number' && (
          <span className="ml-2 text-muted-foreground">p{section.page}</span>
        )}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-foreground">
        {section.text}
      </pre>
    </details>
  );
}

function FieldFindingCard({ d }: { d: Discrepancy & { kind: 'field' } }) {
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

function NarrativeFindingCard({ d }: { d: Discrepancy & { kind: 'narrative' } }) {
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

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString();
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  return JSON.stringify(v);
}

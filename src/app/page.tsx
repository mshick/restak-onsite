import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SEVERITY_LABEL: Record<string, string> = {
  out_of_distribution: 'Out of distribution',
  material: 'Material',
  ambiguous: 'Ambiguous',
  auto_resolved: 'Auto-resolved',
  cosmetic: 'Cosmetic',
};

const SEVERITY_TONE: Record<string, string> = {
  out_of_distribution: 'bg-red-100 text-red-800',
  material: 'bg-amber-100 text-amber-900',
  ambiguous: 'bg-violet-100 text-violet-900',
  auto_resolved: 'bg-emerald-100 text-emerald-900',
  cosmetic: 'bg-slate-100 text-slate-700',
};

export default async function Home() {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from('reconciliation_items')
    .select('id, reference, doc_type, status, severity, due_at, discrepancies, updated_at')
    .order('due_at', { ascending: true, nullsFirst: false });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reconciliation queue</h1>
          <p className="text-sm text-muted-foreground">
            System of record vs. extracted document — flag what needs a human.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">single mock user · no auth</span>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Could not load queue.</p>
          <p className="text-muted-foreground">{error.message}</p>
          <p className="mt-2 text-xs">
            Did you run <code>pnpm db:start</code> and <code>pnpm db:reset</code>?
          </p>
        </div>
      )}

      <ul className="flex flex-col divide-y rounded-lg border">
        {(items ?? []).length === 0 && !error && (
          <li className="p-6 text-sm text-muted-foreground">
            No items yet. <code>pnpm db:reset</code> loads the seed fixtures.
          </li>
        )}
        {(items ?? []).map((item) => {
          const discrepancyCount = Array.isArray(item.discrepancies)
            ? item.discrepancies.length
            : null;
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-4 p-4 hover:bg-muted/30">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{item.reference}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                    {item.doc_type}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {discrepancyCount == null
                    ? 'Not yet compared.'
                    : `${discrepancyCount} difference${discrepancyCount === 1 ? '' : 's'}`}
                  {item.due_at && <> · due {new Date(item.due_at).toLocaleDateString()}</>}
                </span>
              </div>
              {item.severity && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    SEVERITY_TONE[item.severity] ?? 'bg-muted'
                  }`}
                >
                  {SEVERITY_LABEL[item.severity] ?? item.severity}
                </span>
              )}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                {item.status}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href={`/items/${item.id}`}>Open</Link>
              </Button>
            </li>
          );
        })}
      </ul>

      <footer className="text-xs text-muted-foreground">
        LLM comparison lives in{' '}
        <code className="rounded bg-muted px-1 py-0.5">src/lib/reconcile/</code>. Trigger a run from
        the detail view, or <code>POST /api/reconcile</code> with <code>{'{ item_id }'}</code>.
      </footer>
    </main>
  );
}

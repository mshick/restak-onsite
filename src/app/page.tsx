import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import { CopyEmailButton } from './queue-row-actions';

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

const STATUS_LABEL: Record<string, string> = {
  open: 'Pending',
  in_review: 'In review',
  reviewed: 'Reviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  escalated: 'Escalated',
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700',
  in_review: 'bg-sky-100 text-sky-900',
  reviewed: 'bg-emerald-100 text-emerald-900',
};

export default async function Home() {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from('reconciliation_items')
    .select(
      `
      id, reference, status, severity, due_at, discrepancies, updated_at,
      created_at, reviewed_at, email_markdown,
      document:documents!inner ( doc_type, filename ),
      policy:policies!inner (
        policy_number, carrier,
        account:accounts!inner ( account_name )
      )
    `,
    )
    .order('created_at', { ascending: true });

  const sorted = items ?? [];
  // Pending items first (FIFO), then reviewed items (also FIFO by created_at from the DB query)
  const pending = sorted.filter((i) => i.status !== 'reviewed');
  const reviewed = sorted.filter((i) => i.status === 'reviewed');

  function renderRow(item: (typeof sorted)[number], opts: { muted?: boolean } = {}) {
    // PostgREST's typed joins come back as arrays in the supabase-js
    // generated types even when the FK is single-row; unwrap defensively.
    const doc = Array.isArray(item.document) ? item.document[0] : item.document;
    const policy = Array.isArray(item.policy) ? item.policy[0] : item.policy;
    const account = policy
      ? Array.isArray(policy.account)
        ? policy.account[0]
        : policy.account
      : null;

    const discrepancyCount = Array.isArray(item.discrepancies) ? item.discrepancies.length : null;

    const isReviewed = item.status === 'reviewed';
    const duration =
      isReviewed && item.reviewed_at && item.created_at
        ? formatDuration(item.created_at, item.reviewed_at)
        : null;

    return (
      <li
        key={item.id}
        className={`flex flex-wrap items-center gap-4 p-4 hover:bg-muted/30${opts.muted ? ' opacity-60' : ''}`}
      >
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{item.reference}</span>
            {doc?.doc_type && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                {doc.doc_type}
              </span>
            )}
          </div>
          <span className="text-sm">
            {account?.account_name ?? 'Unknown account'}
            {policy?.carrier && <span className="text-muted-foreground"> · {policy.carrier}</span>}
            {policy?.policy_number && (
              <span className="font-mono text-xs text-muted-foreground">
                {' · '}
                {policy.policy_number}
              </span>
            )}
          </span>
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
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_TONE[item.status] ?? 'bg-muted text-muted-foreground'
          }`}
        >
          {STATUS_LABEL[item.status] ?? item.status}
          {duration && <> · {duration}</>}
        </span>
        {isReviewed && <CopyEmailButton markdown={item.email_markdown} />}
        <Button asChild size="sm" variant="outline">
          <Link href={`/items/${item.id}`}>Open</Link>
        </Button>
      </li>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Document queue</h1>
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
        {sorted.length === 0 && !error && (
          <li className="p-6 text-sm text-muted-foreground">
            No items yet. <code>pnpm db:reset</code> loads the seed fixtures.
          </li>
        )}
        {pending.map((item) => renderRow(item))}
        {reviewed.length > 0 && pending.length > 0 && (
          <li className="flex items-center gap-3 px-4 py-2">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">Reviewed</span>
            <span className="h-px flex-1 bg-border" />
          </li>
        )}
        {reviewed.map((item) => renderRow(item, { muted: true }))}
      </ul>

      <footer className="text-xs text-muted-foreground">
        LLM comparison lives in{' '}
        <code className="rounded bg-muted px-1 py-0.5">src/lib/reconcile/</code>. Trigger a run from
        the detail view, or <code>POST /api/reconcile</code> with <code>{'{ item_id }'}</code>.
      </footer>
    </main>
  );
}

function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return '—';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && mins) parts.push(`${mins}m`);
  return parts.join(' ') || '<1m';
}

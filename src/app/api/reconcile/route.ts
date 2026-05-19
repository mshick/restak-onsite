/**
 * POST /api/reconcile
 *
 * Body: { item_id: string }
 *
 * Loads the queue item joined to its document + policy + account,
 * builds the flat SOR object, runs the reconcile pipeline (rules + LLM),
 * and writes `discrepancies` + `severity` back. Returns the updated row.
 *
 * No auth — single mock user. Wire auth in if/when needed.
 */

import { z } from 'zod';
import type { ExtractedDocument } from '@/lib/reconcile';
import { reconcile } from '@/lib/reconcile';
import { type AccountRow, buildSor, type PolicyRow } from '@/lib/sor';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  item_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createClient();

  // Nested PostgREST select: pulls the item, its document (extracted JSON
  // only — skip the multi-MB pdf_blob), its policy, and the policy's
  // account, all in one round-trip.
  const { data: item, error: loadError } = await supabase
    .from('reconciliation_items')
    .select(
      `
      id,
      document:documents!inner ( id, filename, doc_type, extracted ),
      policy:policies!inner (
        policy_number, carrier, policy_type, status,
        premium, effective_date, expiration_date, coverage_limit,
        account:accounts!inner (
          account_id, account_name,
          contact_name, contact_email, contact_phone,
          street, city, state, zip
        )
      )
    `,
    )
    .eq('id', body.data.item_id)
    .maybeSingle();

  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });
  if (!item) return Response.json({ error: 'not_found' }, { status: 404 });

  // PostgREST's inner-join nested selects type as object | object[] depending
  // on cardinality. Each `!inner` we declared is single-row in our schema.
  const policy = item.policy as unknown as PolicyRow & { account: AccountRow };
  const account = policy.account;
  const document = item.document as unknown as { extracted: ExtractedDocument };

  const sor = buildSor(policy, account);
  const { discrepancies, severity } = await reconcile(sor, document.extracted);

  const { data: updated, error: writeError } = await supabase
    .from('reconciliation_items')
    .update({
      discrepancies: discrepancies as unknown as never,
      severity,
    })
    .eq('id', body.data.item_id)
    .select()
    .single();

  if (writeError) return Response.json({ error: writeError.message }, { status: 500 });

  return Response.json({ item: updated });
}

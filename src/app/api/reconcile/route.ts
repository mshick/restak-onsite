/**
 * POST /api/reconcile
 *
 * Body: { item_id: string }
 *
 * Loads the row, runs the reconcile pipeline (rules + LLM), and writes
 * `discrepancies` + `severity` back. Returns the updated row.
 *
 * No auth — single mock user. Wire auth in if/when needed.
 */

import { z } from 'zod';
import type { ExtractedDocument, SystemOfRecord } from '@/lib/reconcile';
import { reconcile } from '@/lib/reconcile';
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

  const { data: item, error: loadError } = await supabase
    .from('reconciliation_items')
    .select('id, system_of_record, extracted')
    .eq('id', body.data.item_id)
    .maybeSingle();

  if (loadError) return Response.json({ error: loadError.message }, { status: 500 });
  if (!item) return Response.json({ error: 'not_found' }, { status: 404 });

  // The DB stores both payloads as `jsonb` so Supabase types them as `Json`.
  // The pipeline expects a flat SOR record and an extraction envelope; the
  // writers (system-of-record API, doc extractor) are responsible for that
  // shape — see src/lib/reconcile/types.ts.
  const { discrepancies, severity } = await reconcile(
    item.system_of_record as unknown as SystemOfRecord,
    item.extracted as unknown as ExtractedDocument,
  );

  const { data: updated, error: writeError } = await supabase
    .from('reconciliation_items')
    .update({
      // JSON columns: Supabase JS client handles serialization.
      discrepancies: discrepancies as unknown as never,
      severity,
    })
    .eq('id', body.data.item_id)
    .select()
    .single();

  if (writeError) return Response.json({ error: writeError.message }, { status: 500 });

  return Response.json({ item: updated });
}

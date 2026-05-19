/**
 * POST /api/upload
 *
 * multipart/form-data with one "file" part (a PDF). Pipeline:
 *
 *   1. fetch candidate policies (every policy joined to its account name)
 *   2. send the PDF + candidates to gpt-5.4-mini for extraction + match
 *   3. validate the match against the candidate list; bind to that policy
 *   4. insert documents row (raw bytes + extracted envelope)
 *   5. insert reconciliation_items row with a derived reference
 *   6. run the reconcile pipeline (rules + LLM) and write back
 *
 * The new row appears in the queue identical to the seeded ones.
 */

import { revalidatePath } from 'next/cache';
import { extractFromPdf, type PolicyCandidate } from '@/lib/extract';
import { reconcile } from '@/lib/reconcile';
import { type AccountRow, buildSor, type PolicyRow } from '@/lib/sor';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — well above any real COI/renewal.

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'file_missing' }, { status: 400 });
  }
  if (file.type && file.type !== 'application/pdf') {
    return Response.json({ error: 'not_a_pdf', got: file.type }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'too_large', size: file.size }, { status: 413 });
  }

  const supabase = createAdminClient();

  const { data: policyRows, error: candErr } = await supabase
    .from('policies')
    .select(
      `
      policy_number, carrier, policy_type,
      account:accounts!inner ( account_id, account_name )
    `,
    );
  if (candErr) return Response.json({ error: candErr.message }, { status: 500 });

  const candidates: PolicyCandidate[] = (policyRows ?? []).map((p) => {
    const account = Array.isArray(p.account) ? p.account[0] : p.account;
    return {
      policy_number: p.policy_number,
      account_id: account?.account_id ?? '',
      account_name: account?.account_name ?? '',
      carrier: p.carrier,
      policy_type: p.policy_type,
    };
  });

  const buffer = new Uint8Array(await file.arrayBuffer());

  let extraction;
  try {
    extraction = await extractFromPdf(buffer, file.name, candidates);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'extraction_failed';
    return Response.json({ error: message }, { status: 502 });
  }

  // Validate the LLM's claimed match against the candidate list. If the
  // model hallucinated a policy_number, drop it; the document still gets
  // saved unbound and the reviewer can fix it.
  const matchedCandidate = extraction.matchedPolicyNumber
    ? candidates.find((c) => c.policy_number === extraction.matchedPolicyNumber)
    : undefined;

  let policyId: string | null = null;
  let policyForReconcile: (PolicyRow & { account: AccountRow }) | null = null;
  if (matchedCandidate) {
    const { data: policyRow, error: policyErr } = await supabase
      .from('policies')
      .select(
        `
        id, policy_number, carrier, policy_type, status,
        premium, effective_date, expiration_date, coverage_limit,
        account:accounts!inner (
          account_id, account_name,
          contact_name, contact_email, contact_phone,
          street, city, state, zip
        )
      `,
      )
      .eq('policy_number', matchedCandidate.policy_number)
      .maybeSingle();
    if (policyErr) return Response.json({ error: policyErr.message }, { status: 500 });
    if (policyRow) {
      policyId = policyRow.id;
      const account = Array.isArray(policyRow.account) ? policyRow.account[0] : policyRow.account;
      policyForReconcile = { ...(policyRow as unknown as PolicyRow), account: account as AccountRow };
    }
  }

  const { data: docRow, error: docErr } = await supabase
    .from('documents')
    .insert({
      filename: file.name,
      doc_type: extraction.docType,
      policy_id: policyId,
      // Supabase JS expects base64 for bytea inserts.
      pdf_blob: `\\x${Buffer.from(buffer).toString('hex')}`,
      pdf_size_bytes: buffer.byteLength,
      extracted: extraction.extracted as unknown as never,
      extractor: 'upload-gpt-5.4-mini',
    })
    .select('id')
    .single();
  if (docErr) return Response.json({ error: docErr.message }, { status: 500 });

  const reference = await uniqueReference(supabase, extraction.referenceSlug || 'UPLOAD');

  const { data: itemRow, error: itemErr } = await supabase
    .from('reconciliation_items')
    .insert({
      reference,
      document_id: docRow.id,
      policy_id: policyId,
    })
    .select('id')
    .single();
  if (itemErr) return Response.json({ error: itemErr.message }, { status: 500 });

  // Run reconcile only if we bound to a policy — without an SOR row there
  // is nothing to compare against. The reviewer can still open the item
  // and see the unmatched state.
  if (policyForReconcile) {
    const sor = buildSor(policyForReconcile, policyForReconcile.account);
    const { discrepancies, severity } = await reconcile(sor, extraction.extracted);
    const { error: updateErr } = await supabase
      .from('reconciliation_items')
      .update({
        discrepancies: discrepancies as unknown as never,
        severity,
      })
      .eq('id', itemRow.id);
    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });
  }

  revalidatePath('/');

  return Response.json({
    item_id: itemRow.id,
    reference,
    matched_policy_number: extraction.matchedPolicyNumber,
    match_reason: extraction.matchReason,
    bound: Boolean(policyId),
  });
}

/**
 * Pick a reference that does not collide with an existing row. The seed
 * uses fixed slugs (e.g. "GREENFIELD-CGL-2026-RENEWAL") so re-uploading
 * the same PDF needs a suffix to avoid the unique-ish queue handle
 * clashing visually.
 */
async function uniqueReference(
  supabase: ReturnType<typeof createAdminClient>,
  base: string,
): Promise<string> {
  const normalized = base.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-');
  const { data } = await supabase
    .from('reconciliation_items')
    .select('reference')
    .like('reference', `${normalized}%`);
  const taken = new Set((data ?? []).map((r) => r.reference));
  if (!taken.has(normalized)) return normalized;
  for (let i = 2; i < 50; i++) {
    const candidate = `${normalized}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${normalized}-${Date.now()}`;
}

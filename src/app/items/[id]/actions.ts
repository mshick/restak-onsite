'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { draftEmail } from '@/lib/email';
import { buildEmailInput } from '@/lib/email/build-input';
import type { DecisionLogEntry, Discrepancy } from '@/lib/reconcile';
import type { Json } from '@/lib/db/database.types';
import { createAdminClient } from '@/lib/supabase/admin';

const REVIEWER_ID = 'demo@brokerage.test';

async function loadItem(itemId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('reconciliation_items')
    .select(
      `
      id, status, discrepancies, decision_log, email_markdown, reviewer_notes,
      document:documents!inner ( id, filename, doc_type, extracted_at ),
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
    .eq('id', itemId)
    .single();
  if (error) throw error;
  return data;
}

function appendEvent(log: unknown, entry: DecisionLogEntry): DecisionLogEntry[] {
  const arr = Array.isArray(log) ? (log as DecisionLogEntry[]) : [];
  return [...arr, entry];
}

function nextStatus(current: string, target: 'in_review' | 'reviewed') {
  if (target === 'reviewed') return 'reviewed';
  return current === 'open' ? 'in_review' : current;
}

function revalidateBoth(itemId: string) {
  revalidatePath(`/items/${itemId}`);
  revalidatePath('/');
}

export async function toggleFlag(
  itemId: string,
  discrepancyId: string,
  nextState: 'include' | 'exclude',
) {
  const supabase = createAdminClient();
  const item = await loadItem(itemId);
  const discrepancies = (item.discrepancies ?? []) as unknown as Discrepancy[];
  const updated = discrepancies.map((d) =>
    d.id === discrepancyId ? { ...d, flag_state: nextState } : d,
  );
  const entry: DecisionLogEntry = {
    at: new Date().toISOString(),
    actor: 'reviewer',
    action: nextState === 'include' ? 'include_in_email' : 'exclude_from_email',
    discrepancy_id: discrepancyId,
  };
  await supabase
    .from('reconciliation_items')
    .update({
      discrepancies: updated as unknown as Json,
      decision_log: appendEvent(item.decision_log, entry) as unknown as Json,
      status: nextStatus(item.status, 'in_review'),
      email_markdown: null,
    })
    .eq('id', itemId);
  revalidateBoth(itemId);
}

export async function editRationale(
  itemId: string,
  discrepancyId: string,
  nextRationale: string,
) {
  const supabase = createAdminClient();
  const item = await loadItem(itemId);
  const discrepancies = (item.discrepancies ?? []) as unknown as Discrepancy[];
  const updated = discrepancies.map((d) =>
    d.id === discrepancyId ? { ...d, final_rationale: nextRationale } : d,
  );
  const entry: DecisionLogEntry = {
    at: new Date().toISOString(),
    actor: 'reviewer',
    action: 'rationale_edit',
    discrepancy_id: discrepancyId,
    note: nextRationale,
  };
  await supabase
    .from('reconciliation_items')
    .update({
      discrepancies: updated as unknown as Json,
      decision_log: appendEvent(item.decision_log, entry) as unknown as Json,
      status: nextStatus(item.status, 'in_review'),
      email_markdown: null,
    })
    .eq('id', itemId);
  revalidateBoth(itemId);
}

export async function generateEmail(
  itemId: string,
): Promise<{ markdown: string; source: 'llm' | 'template' }> {
  const supabase = createAdminClient();
  const item = await loadItem(itemId);
  const policy = unwrap(item.policy);
  const account = unwrap(policy?.account);
  const document = unwrap(item.document);
  if (!policy || !account || !document) {
    throw new Error('Item is missing required joins');
  }
  const input = buildEmailInput({
    policy,
    account,
    document,
    discrepancies: (item.discrepancies ?? []) as unknown as Discrepancy[],
    reviewer_notes: item.reviewer_notes,
  });
  const result = await draftEmail(input);
  const entry: DecisionLogEntry = {
    at: new Date().toISOString(),
    actor: 'reviewer',
    action: 'generate_email',
    note: result.source,
  };
  await supabase
    .from('reconciliation_items')
    .update({
      email_markdown: result.markdown,
      decision_log: appendEvent(item.decision_log, entry) as unknown as Json,
      status: nextStatus(item.status, 'in_review'),
    })
    .eq('id', itemId);
  revalidateBoth(itemId);
  return result;
}

export async function submitReview(itemId: string, editedMarkdown?: string) {
  const supabase = createAdminClient();
  const item = await loadItem(itemId);

  let finalMarkdown = editedMarkdown ?? item.email_markdown;
  if (!finalMarkdown) {
    const policy = unwrap(item.policy);
    const account = unwrap(policy?.account);
    const document = unwrap(item.document);
    if (!policy || !account || !document) {
      throw new Error('Item is missing required joins');
    }
    const input = buildEmailInput({
      policy,
      account,
      document,
      discrepancies: (item.discrepancies ?? []) as unknown as Discrepancy[],
      reviewer_notes: item.reviewer_notes,
    });
    const result = await draftEmail(input);
    finalMarkdown = result.markdown;
  }

  const submitEntry: DecisionLogEntry = {
    at: new Date().toISOString(),
    actor: 'reviewer',
    action: 'submit',
  };
  await supabase
    .from('reconciliation_items')
    .update({
      email_markdown: finalMarkdown,
      decision_log: appendEvent(item.decision_log, submitEntry) as unknown as Json,
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
      reviewed_by: REVIEWER_ID,
    })
    .eq('id', itemId);

  revalidateBoth(itemId);
  redirect('/');
}

function unwrap<T>(v: T | T[] | null | undefined): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

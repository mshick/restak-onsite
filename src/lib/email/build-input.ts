import type { Discrepancy } from '@/lib/reconcile';
import type { AccountRow, PolicyRow } from '@/lib/sor';
import type { EmailDraftInput, EmailItem } from './types';

interface BuildInputArgs {
  policy: PolicyRow & { policy_number: string };
  account: AccountRow;
  document: { doc_type: string; filename: string; extracted_at?: string };
  discrepancies: Discrepancy[];
  reviewer_notes?: string | null;
}

const REVIEWER_NAME = 'Demo Reviewer';

export function buildEmailInput({
  policy,
  account,
  document,
  discrepancies,
  reviewer_notes,
}: BuildInputArgs): EmailDraftInput {
  const included = discrepancies.filter((d) => d.flag_state === 'include');
  const items: EmailItem[] = included.map((d) => {
    if (d.kind === 'field') {
      return {
        label: d.field,
        system_value: stringify(d.system_value),
        extracted_value: stringify(d.extracted_value),
        page: d.evidence?.page,
        rationale: d.final_rationale,
      };
    }
    return {
      label: d.section,
      page: d.page,
      rationale: d.final_rationale,
    };
  });
  return {
    account: { id: account.account_id, name: account.account_name },
    policy: {
      number: policy.policy_number,
      carrier: policy.carrier,
      type: policy.policy_type,
      effective_date: policy.effective_date,
    },
    document: {
      doc_type: document.doc_type,
      filename: document.filename,
      date: document.extracted_at,
    },
    items,
    reviewer_notes: reviewer_notes ?? undefined,
    reviewer_name: REVIEWER_NAME,
  };
}

function stringify(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

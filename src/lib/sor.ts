/**
 * Builds the flat "system of record" object the reconcile pipeline compares
 * against. Joins a policy row with its parent account; the keys must match
 * what the LLM is told to look for in prompts (see src/lib/reconcile/prompts.ts).
 *
 * Numeric Postgres columns can come back from Supabase as strings, so we
 * coerce them through Number() before stringification.
 */

export interface PolicyRow {
  policy_number: string;
  carrier: string;
  policy_type: string;
  status: string;
  premium: number | string | null;
  effective_date: string | null;
  expiration_date: string | null;
  coverage_limit: number | string | null;
}

export interface AccountRow {
  account_id: string;
  account_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export function composeAddress(account: AccountRow): string | null {
  const parts = [account.street, account.city, account.state, account.zip].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.length ? parts.join(', ') : null;
}

function toNumber(v: number | string | null): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildSor(policy: PolicyRow, account: AccountRow): Record<string, unknown> {
  return {
    named_insured: account.account_name,
    contact_name: account.contact_name,
    contact_email: account.contact_email,
    contact_phone: account.contact_phone,
    mailing_address: composeAddress(account),
    policy_number: policy.policy_number,
    carrier: policy.carrier,
    policy_type: policy.policy_type,
    premium: toNumber(policy.premium),
    effective_date: policy.effective_date,
    expiration_date: policy.expiration_date,
    coverage_limit: toNumber(policy.coverage_limit),
  };
}

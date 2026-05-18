-- Single denormalized table for the reconciliation queue.
--
-- One row = one document-to-system-of-record comparison the reviewer
-- needs to decide on. The system-of-record snapshot and the extracted
-- document are both JSONB so the schema can absorb whatever shape the
-- onsite hands us (COI fields, renewal line items, endorsement deltas).
--
-- No RLS, no auth — the prototype runs as a single mock user.

create extension if not exists pgcrypto;

-- uuid v7 keeps inserts time-ordered without needing application logic.
create or replace function public.uuid_generate_v7()
returns uuid
language plpgsql
volatile
parallel safe
set search_path = pg_catalog, extensions
as $$
declare
  v_ts_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_bytes bytea  := gen_random_bytes(16);
begin
  v_bytes := set_byte(v_bytes, 0, ((v_ts_ms >> 40) & 255)::int);
  v_bytes := set_byte(v_bytes, 1, ((v_ts_ms >> 32) & 255)::int);
  v_bytes := set_byte(v_bytes, 2, ((v_ts_ms >> 24) & 255)::int);
  v_bytes := set_byte(v_bytes, 3, ((v_ts_ms >> 16) & 255)::int);
  v_bytes := set_byte(v_bytes, 4, ((v_ts_ms >> 8)  & 255)::int);
  v_bytes := set_byte(v_bytes, 5, ( v_ts_ms        & 255)::int);
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);
  return encode(v_bytes, 'hex')::uuid;
end;
$$;

create table public.reconciliation_items (
  id uuid primary key default public.uuid_generate_v7(),

  -- Human-readable handle for the queue ("ACME-COI-2026-04").
  reference text not null,

  -- What kind of document this is. Keeps a column free for filtering
  -- without locking the schema to one taxonomy.
  doc_type text not null check (doc_type in (
    'coi',          -- certificate of insurance
    'renewal',      -- renewal proposal
    'endorsement',  -- mid-term amendment
    'audit',        -- workers' comp / payroll audit
    'other'
  )),

  -- Queue state. Status is independent of discrepancy severity:
  -- a low-severity item can still be 'open' if no one has decided yet.
  status text not null default 'open' check (status in (
    'open', 'in_review', 'accepted', 'rejected', 'escalated'
  )),

  -- Highest tier discrepancy on the item — drives queue sort/color.
  -- Mirrors the taxonomy in src/lib/reconcile/types.ts.
  severity text check (severity in (
    'cosmetic', 'auto_resolved', 'material', 'ambiguous', 'out_of_distribution'
  )),

  -- Deadline pressure, optional. Used for queue ordering.
  due_at timestamptz,

  -- The two payloads being compared. JSONB so the onsite can hand us
  -- anything; the UI walks them as key/value pairs.
  system_of_record jsonb not null,
  extracted jsonb not null,

  -- Computed comparison output. Array of discrepancy records, shape
  -- defined in src/lib/reconcile/types.ts. Written by the reconcile
  -- pipeline (rules + LLM). Null until first run.
  discrepancies jsonb,

  -- Free-text notes from the reviewer, plus a structured decision log.
  reviewer_notes text,
  decision_log jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);

create index reconciliation_items_status_due_idx
  on public.reconciliation_items (status, due_at nulls last);

create index reconciliation_items_severity_idx
  on public.reconciliation_items (severity);

-- Bump updated_at on every write.
create or replace function public.touch_reconciliation_items_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger reconciliation_items_touch_updated_at
  before update on public.reconciliation_items
  for each row execute function public.touch_reconciliation_items_updated_at();

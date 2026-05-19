-- Initial schema for the reconciliation prototype.
--
-- Four tables:
--
--   accounts            — the brokerage's clients
--   policies            — a placed policy on a client; the system-of-record row
--   documents           — a PDF received from a carrier or vendor, with the
--                         extractor's per-field envelope stored alongside the
--                         raw bytes
--   reconciliation_items — one queue row per (document, policy) pair the
--                         reviewer has to decide on
--
-- The reconcile pipeline builds the SOR object by joining policies + accounts;
-- the extracted half comes straight from documents.extracted. No inline jsonb
-- snapshots — both halves are addressable.
--
-- No RLS, no auth — the prototype runs as a single mock user.

create extension if not exists pgcrypto;

-- uuid v7 generator: time-ordered prefix gives better B-tree locality than v4.
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

-- Shared updated_at touch function -------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- accounts -------------------------------------------------------------------
-- The brokerage's client roster. `account_id` is the human-readable handle the
-- brokerage uses (ACC-#####); `id` is the internal uuid we reference from
-- policies.

create table public.accounts (
  id uuid primary key default public.uuid_generate_v7(),
  account_id text unique not null,
  account_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  street text,
  city text,
  state text,
  zip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- policies -------------------------------------------------------------------
-- One placed policy per row. This is the "system of record" half of every
-- reconciliation — what the brokerage believes is true about a policy as of
-- right now. `coverage_limit` is intentionally a single nullable column; real
-- policies have many limits (each-occurrence, aggregate, etc.) but a single
-- column matches the CSV the brokerage actually keeps.

create table public.policies (
  id uuid primary key default public.uuid_generate_v7(),
  policy_number text unique not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  carrier text not null,
  policy_type text not null,
  status text not null default 'active',
  premium numeric(12,2),
  effective_date date,
  expiration_date date,
  coverage_limit numeric(15,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index policies_account_id_idx on public.policies(account_id);

create trigger policies_touch_updated_at
  before update on public.policies
  for each row execute function public.touch_updated_at();

-- documents ------------------------------------------------------------------
-- A document received from a carrier or vendor, plus the structured extraction
-- the extractor produced from it. `pdf_blob` is the raw bytes so the prototype
-- is self-contained (a real deployment would put these in object storage and
-- keep only a URL here). `extracted` matches src/lib/reconcile/types.ts
-- ExtractedDocument: per-field { value, raw_text, confidence, page } envelopes
-- plus `unparsed_sections[]` for free-text the extractor couldn't classify.

create table public.documents (
  id uuid primary key default public.uuid_generate_v7(),
  filename text not null,
  doc_type text not null check (doc_type in (
    'coi',          -- certificate of insurance (third-party vendor proof)
    'certificate',  -- carrier-issued certificate against a placed policy
    'renewal',      -- renewal proposal
    'endorsement',  -- mid-term amendment (some carriers also use for renewals)
    'audit',        -- workers' comp / payroll audit
    'other'
  )),
  policy_id uuid references public.policies(id) on delete set null,
  pdf_blob bytea not null,
  pdf_size_bytes integer not null,
  extracted jsonb not null,
  extracted_at timestamptz not null default now(),
  extractor text not null default 'manual',
  created_at timestamptz not null default now()
);

create index documents_policy_id_idx on public.documents(policy_id);
create index documents_doc_type_idx on public.documents(doc_type);

-- reconciliation_items -------------------------------------------------------
-- Queue rows. One per (document, policy) pair the reviewer must decide on.
-- Discrepancies are computed by the reconcile pipeline; decision_log is an
-- append-only audit trail of reviewer actions.

create table public.reconciliation_items (
  id uuid primary key default public.uuid_generate_v7(),

  -- Human-readable handle for the queue (e.g. "GREENFIELD-CGL-2026-RENEWAL").
  reference text not null,

  document_id uuid references public.documents(id) on delete cascade not null,
  policy_id uuid references public.policies(id) on delete set null,

  status text not null default 'open' check (status in (
    'open', 'in_review', 'accepted', 'rejected', 'escalated'
  )),

  -- Highest-tier discrepancy on the item; drives queue sort/color.
  severity text check (severity in (
    'cosmetic', 'auto_resolved', 'material', 'ambiguous', 'out_of_distribution'
  )),

  due_at timestamptz,
  discrepancies jsonb,
  reviewer_notes text,
  decision_log jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);

create index reconciliation_items_document_id_idx on public.reconciliation_items(document_id);
create index reconciliation_items_status_due_idx
  on public.reconciliation_items(status, due_at nulls last);
create index reconciliation_items_severity_idx
  on public.reconciliation_items(severity);

create trigger reconciliation_items_touch_updated_at
  before update on public.reconciliation_items
  for each row execute function public.touch_updated_at();

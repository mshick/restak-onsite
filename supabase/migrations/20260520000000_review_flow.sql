-- Review-flow additions to reconciliation_items.
--
-- email_markdown   — the finalized carrier-addressed email text, set on submit.
-- reviewed_at      — when the reviewer hit submit. Null while pending.
-- reviewed_by      — single mock user for the prototype. Null while pending.
--
-- The status check is widened to add 'reviewed' as a terminal state.
-- The existing 'accepted' / 'rejected' / 'escalated' values are retained for
-- forward compatibility but are unused by v1.

alter table public.reconciliation_items
  add column reviewed_at timestamptz,
  add column reviewed_by text,
  add column email_markdown text;

alter table public.reconciliation_items
  drop constraint reconciliation_items_status_check;

alter table public.reconciliation_items
  add constraint reconciliation_items_status_check
  check (status in ('open', 'in_review', 'reviewed', 'accepted', 'rejected', 'escalated'));

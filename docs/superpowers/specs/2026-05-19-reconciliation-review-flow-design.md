# Reconciliation Review Flow — Design

**Date:** 2026-05-19
**Status:** Draft for review
**Related:** [docs/onsite-prep.md](../../onsite-prep.md), [src/lib/reconcile/README.md](../../../src/lib/reconcile/README.md)

## Problem

An account manager at an insurance brokerage receives carrier renewal documents (and certificates, audits, endorsements) and must reconcile them against the brokerage's system of record. Today this is line-by-line PDF-vs-spreadsheet comparison. We are building a tool that does the comparison automatically, surfaces discrepancies in a reviewer-friendly UI, lets the reviewer decide which discrepancies belong in a follow-up email to the carrier, and produces that email as ready-to-copy markdown. Every decision is logged for audit and for future feedback-loop training.

## Persona and goal

Single persona: a brokerage account manager. The single goal of a review session is to produce one markdown email per renewal, addressed to the **carrier / underwriter**, asking them to clarify or correct material differences between the renewal document and the system of record. The reviewer's only on-screen decisions are:

1. For each discrepancy: include it in the email, yes/no.
2. For each included discrepancy: confirm or edit the suggested rationale.
3. Submit the review when done.

Everything else (tiering, computing differences, drafting rationales) is the system's job.

## Scope

In scope:

- A queue screen showing all reconciliation items, FIFO by `created_at`, with status, severity, and time-to-completion visible.
- A review screen per item: SOR vs. extracted side-by-side, discrepancies grouped by material / auto-resolved, per-discrepancy include-in-email toggle + editable rationale, live email preview, submit action.
- Persistence of every decision (flag flips, rationale edits, submit) in `reconciliation_items.decision_log` as the audit trail.
- Generation of the email markdown on submit, persisted on the row, copyable from the queue and detail screens.
- Minimal LLM-seam extension: emit a carrier-facing `suggested_rationale` per finding.

Out of scope for v1:

- Sending the email (copy-to-clipboard only).
- Multi-reviewer assignment, claim-locking, concurrency.
- A UI affordance for "make this an auto-rule in the future." The decision log gives us the data; we narrate the feedback loop verbally during the demo.
- Editing the extracted values themselves (a real reviewer's first job is correcting extraction errors; we acknowledge but cut for time).
- Re-opening a reviewed item.
- Auth — single mock user `demo@brokerage.test`.

## Current codebase state (relevant facts)

The repo has been re-shaped since the prior brief. Four tables now (`accounts`, `policies`, `documents`, `reconciliation_items`); CLAUDE.md's "one denormalized table" description is stale and should be updated as part of this work.

- `src/lib/sor.ts` builds the SOR object from a `policies` + `accounts` join.
- `documents.extracted` holds the extraction envelope (`fields[name] = {value, raw_text, confidence, page}` + `unparsed_sections[]`).
- The reconcile pipeline in `src/lib/reconcile/` runs unchanged: rules pre-pass for trivial equivalences, LLM pass as primary comparator for material/ambiguous/narrative findings.
- Discrepancies persist as JSON in `reconciliation_items.discrepancies` with stable per-finding `id`.
- `reconciliation_items.decision_log jsonb` already exists (default `'[]'::jsonb`).
- `reconciliation_items.severity` is pre-computed as the highest tier on the item; the queue color-codes by it.
- Five real PDFs are seeded with realistic per-field confidence scores.

## Architecture

The chosen shape: **two screens, with the email preview living inside the detail view.** No third screen, no slide-out drawer. The reviewer sees the email assemble itself as they flag discrepancies, which makes the artifact-production mental model legible and demos cleanly.

```
/                 → queue screen (FIFO list)
/items/[id]       → review screen
                    ├─ header strip (account / policy / carrier)
                    ├─ SOR ↔ extracted side-by-side (existing)
                    ├─ unparsed sections block (existing)
                    ├─ two-column body:
                    │   ├─ left: discrepancy cards
                    │   │   ├─ material section (expanded)
                    │   │   └─ "handled automatically" section (collapsed)
                    │   └─ right: live email markdown preview
                    └─ submit footer
```

Server actions handle the writes (flag flip, rationale edit, submit). TanStack Query (already wired in the starter) revalidates the detail page after each mutation. Optimistic updates are not necessary at this scale.

## Screens

### Queue screen (`/`)

Columns, left to right: `reference` (mono), `account_name` · `carrier` · `policy_number`, doc type badge, discrepancy count (or "not yet compared"), severity tier badge, status badge, time-to-completion, "Open" button.

Sort: `created_at` ascending (FIFO) — replaces the current `due_at` sort. Reviewed items remain in the list, visually muted, sorted below pending items.

Status badge values:

- **Pending** — `status = 'open'`
- **In review** — `status = 'in_review'` (auto-set on first interaction with the item)
- **Reviewed** — `status = 'reviewed'` (set on submit) — render as a check + the time-to-completion string.

Time-to-completion: rendered only when `status = 'reviewed'`. Formula: `reviewed_at - created_at`, formatted as `"2h 14m"` / `"3d 4h"`. For not-yet-reviewed items, render `—`.

A copy-to-clipboard button on each reviewed row exposes the saved `email_markdown` without making the user open the detail view again.

### Review screen (`/items/[id]`)

**Header strip** (existing 3-column layout: account / policy / carrier) — unchanged.

**SOR vs. extracted side-by-side** (existing) — unchanged. Stays at the top because verifying the comparison underlies every discrepancy decision below it.

**Unparsed sections block** (existing) — unchanged. Critical for material narrative findings to feel grounded.

**Body — two columns:**

*Left column — discrepancy cards.* Two sub-sections.

1. **Material discrepancies** (tiers `material`, `ambiguous`, `out_of_distribution`), expanded by default.

   Each card shows the existing field/narrative content (field name + SOR vs. extracted values, or narrative excerpt) plus two new controls:

   - **`Include in email` toggle.** Defaults: `material` → ON, `ambiguous` → ON, `out_of_distribution` → ON. The reviewer can flip any of these.
   - **`Rationale (carrier-facing)` textarea.** Pre-filled with the LLM's `suggested_rationale` (1–2 sentences, neutral, written as if speaking to the underwriter). The reviewer can edit freely.

2. **Handled automatically** (tiers `cosmetic`, `auto_resolved`), collapsed by default. Count visible in the header (e.g., "Handled automatically (4)").

   When expanded, each card shows the same shape but:

   - **`Include in email` toggle.** Defaults OFF.
   - **`Rationale (carrier-facing)` textarea.** Pre-filled with a templated string (e.g., "Normalized 'Inc' vs 'Inc.'; treated as equivalent."). The reviewer can flip to include + edit if they want it called out anyway.

   Even though the reviewer rarely touches this section, every discrepancy still needs a decision before submit — they just inherit the defaults automatically. No per-card click required.

*Right column — email panel.* Two states, both markdown-rendered.

1. **Draft preview (default).** A deterministic template, regenerated on every flag flip and rationale edit. Cheap, instant, no LLM call. Lets the reviewer see at-a-glance which items are queued for the email and what the rationales look like in context, as they work.

2. **Generated email (after the reviewer clicks "Generate email").** A polished version produced by a second LLM call (see the email-drafting seam below). Rendered in place of the template. The reviewer can edit the markdown inline (textarea swap) before submitting. Submit persists exactly what is shown.

A `Generate email` button at the top of the panel fires the LLM call (loading state inline). A `Regenerate` button replaces it once a generated version exists. A `Copy markdown` button is always available — copies whatever is currently in the panel (template or generated).

The deterministic template shape — also used as guidance for the LLM-drafting prompt:

```markdown
Subject: Renewal review — [account_name] / [policy_number]

Hi [carrier] team,

We've reviewed the [doc_type] dated [doc_date] against our records for
[account_name] (account [account_id]) and have the following items to
clarify before we can confirm placement:

1. **[field or section label]** — [final_rationale]
   - System of record: [system_value]
   - Document: [extracted_value]
   - [page reference if available]

2. ...

[optional: trailing `reviewer_notes` block]

Thanks,
[reviewer_name]
```

**Submit footer.** Sticky at the bottom of the page.

- A summary line: "12 discrepancies · 4 to include in email · ready to submit" (or "still loading" if reconcile hasn't run, "needs decisions on N items" if any discrepancy has no `flag_state` — should never happen given defaults, but defensive).
- A primary `Submit & mark reviewed` button. Disabled until reconcile has run.
- Submit behavior:
  - If the reviewer has already generated (and optionally edited) an email, that markdown is persisted as `email_markdown`.
  - If the reviewer never clicked `Generate email`, submit fires the LLM call server-side as part of the submit transaction so we never persist the template (a polished email is the artifact we want in the audit record). Fallback: if `OPENAI_API_KEY` is missing or the call fails, persist the template and surface a non-fatal warning.
- Submit also sets `reviewed_at = now()`, `reviewed_by = 'demo@brokerage.test'`, `status = 'reviewed'`, and appends a `submit` entry on `decision_log`. Redirects to `/` with the row now in the reviewed group.

## Data model changes

All changes additive. No drops. One migration.

### `reconciliation_items` table

Add columns:

```sql
alter table public.reconciliation_items
  add column reviewed_at timestamptz,
  add column reviewed_by text,
  add column email_markdown text;
```

Extend status check constraint:

```sql
alter table public.reconciliation_items drop constraint reconciliation_items_status_check;
alter table public.reconciliation_items add constraint reconciliation_items_status_check
  check (status in ('open', 'in_review', 'reviewed', 'accepted', 'rejected', 'escalated'));
```

Leave `accepted` / `rejected` / `escalated` in the constraint — unused by v1, available if the onsite scenario nudges us back toward per-discrepancy approval semantics.

`reviewer_notes text` is already on the table. We repurpose it as the optional trailing block in the email (the reviewer's free-text addendum). No type change.

### `discrepancies` JSON shape (no DDL)

Each discrepancy in `reconciliation_items.discrepancies` gains three fields:

```ts
flag_state: 'include' | 'exclude';
suggested_rationale: string;
final_rationale: string;
```

`final_rationale` starts equal to `suggested_rationale`; reviewer edits change it. `flag_state` defaults per-tier as described above. These live in the jsonb blob — no migration needed.

### `decision_log` JSON shape (no DDL)

Extend the `DecisionLogEntry.action` union in [src/lib/reconcile/types.ts](../../../src/lib/reconcile/types.ts) to add:

```ts
| 'include_in_email'      // flag flipped on
| 'exclude_from_email'    // flag flipped off
| 'rationale_edit'        // final_rationale changed
| 'generate_email'        // LLM draft produced (or template fallback); note carries `source`
| 'submit'                // review finalized, email saved
```

Existing `'accept' | 'reject' | 'edit' | 'escalate' | 'auto_resolve' | 'comment'` actions stay. Type-only change.

Sample entries:

```json
{ "at": "2026-05-19T14:22:11Z", "actor": "reviewer", "action": "include_in_email", "discrepancy_id": "d_3" }
{ "at": "2026-05-19T14:22:45Z", "actor": "reviewer", "action": "rationale_edit", "discrepancy_id": "d_3", "note": "Asked for clarification on which limit applies." }
{ "at": "2026-05-19T14:25:02Z", "actor": "reviewer", "action": "submit" }
```

## Email-drafting seam (new module)

A second LLM seam, separate from the reconcile comparator. Lives in `src/lib/email/` and mirrors the structure of `src/lib/reconcile/`.

```
src/lib/email/
  index.ts        # draftEmail(input) — public surface
  prompts.ts      # SYSTEM_PROMPT + buildUserPrompt(input)
  draft.ts        # OpenAI call via @ai-sdk/openai; returns plain markdown
  template.ts     # deterministic fallback used by the live preview
                  # and on LLM failure
  types.ts        # EmailDraftInput / EmailDraftResult
```

**Input.** The `EmailDraftInput` shape carries everything the model needs and nothing it doesn't — specifically, only `include`-flagged discrepancies are passed:

```ts
interface EmailDraftInput {
  account: { id: string; name: string };
  policy: { number: string; carrier: string; type: string; effective_date: string | null };
  document: { doc_type: string; filename: string; date?: string };
  items: Array<{
    label: string;           // field name or section title
    system_value?: string;   // omitted for narrative findings
    extracted_value?: string;
    page?: number;
    rationale: string;       // final_rationale, after any reviewer edits
  }>;
  reviewer_notes?: string;
  reviewer_name: string;     // mock user display name
}
```

**Output.** `EmailDraftResult` is just `{ markdown: string; source: 'llm' | 'template' }`. `source` lets the UI badge the panel ("drafted by gpt-5.4-mini" vs "template fallback") and the audit log distinguish the two.

**Prompt.** The system prompt makes three things explicit so the model behaves as a polisher rather than a second judge:

1. You are drafting a professional, neutral-toned email from a brokerage account manager to an insurance carrier underwriter. The goal is to ask the carrier to clarify or correct each listed item before placement is confirmed.
2. You MUST NOT introduce new findings, change the meaning of rationales, or remove items. You may reorder them by severity if it improves readability. You may consolidate wording but the substance of each rationale must be preserved.
3. Output markdown only. Start with `Subject: ...` on the first line, then a salutation, then a numbered list of items each formatted as in the reference template above, then an optional reviewer-notes paragraph if provided, then a sign-off using `reviewer_name`.

**Model and cost.** Same model as the comparator (`gpt-5.4-mini`). One call per generate or submit. No streaming — we want the markdown atomically so we can render it. Expected per-call cost is negligible at demo scale.

**Fallback.** If `OPENAI_API_KEY` is missing or the call fails, `draftEmail` returns the deterministic template output and sets `source: 'template'`. The submit transaction still succeeds; the audit log carries the warning.

**Public surface.**

```ts
export async function draftEmail(input: EmailDraftInput): Promise<EmailDraftResult>;
export function renderTemplate(input: EmailDraftInput): string;  // for the live preview
```

Server actions (`generateEmail`, `submitReview`) call `draftEmail`. The detail-page right column (server component) calls `renderTemplate` for the draft preview state.

## LLM seam changes (reconcile)

All inside `src/lib/reconcile/`. Callers (queue, detail, API route) do not move.

### `prompts.ts`

Extend the system prompt: instruct the model to also emit a `suggested_rationale` per finding — 1–2 sentences, carrier-facing tone (neutral, factual, asks for clarification rather than asserts fault), suitable to drop into a bulleted list under "items to clarify before we can confirm placement."

For `cosmetic` and `auto_resolved` rule-emitted findings, the rationale is templated in `rules.ts` rather than from the LLM — no second model call needed.

### `types.ts`

Add `suggested_rationale: string` to `DiscrepancyBase`. Both `FieldDiscrepancy` and `NarrativeDiscrepancy` inherit it. Update the zod schema correspondingly in `llm.ts` so the LLM's structured output is validated.

### `index.ts` (post-process step)

After merging rules + LLM findings:

1. Ensure every discrepancy has a stable `id` (already guaranteed by `DiscrepancyBase`).
2. For each, set:
   - `flag_state = (tier ∈ {material, ambiguous, out_of_distribution}) ? 'include' : 'exclude'`
   - `final_rationale = suggested_rationale`
3. For rule-emitted findings, attach the templated `suggested_rationale` (the rules pre-pass produces it locally).

No change to `reconcile()`'s return type beyond the wider `Discrepancy` shape.

## Server actions

All in [src/app/items/\[id\]/](../../../src/app/items/[id]/). Five actions:

1. `toggleFlag(itemId, discrepancyId, nextState)` — updates the discrepancy's `flag_state` in the jsonb, appends an `include_in_email` or `exclude_from_email` event to `decision_log`. Also auto-sets `status = 'in_review'` if it was `'open'`. Invalidates any previously-generated `email_markdown` (set back to `null`) since the flag set has changed — forces a regenerate before submit.

2. `editRationale(itemId, discrepancyId, nextRationale)` — updates `final_rationale`, appends a `rationale_edit` event. Auto-set `status` as above. Same email-invalidation behavior. Debounce on the client to avoid event-log flooding (e.g., 500ms after last keypress before fire).

3. `generateEmail(itemId)` — pulls the current row + joined policy/account/document, builds `EmailDraftInput` (filtered to `flag_state === 'include'` discrepancies), calls `draftEmail`, persists the result as `email_markdown`, appends a `generate_email` event to `decision_log` carrying the `source` (`llm` or `template`). Returns the markdown so the client can show it.

4. `submitReview(itemId, editedMarkdownOrNull)` — if `editedMarkdownOrNull` is provided (reviewer edited the generated email inline), persist that as `email_markdown`; otherwise if `email_markdown` is null, call `draftEmail` server-side and persist its output. Then set `reviewed_at`, `reviewed_by`, `status = 'reviewed'`, append `submit` event. Redirect to `/`.

5. `runReconcile(itemId)` — already exists at [src/app/items/\[id\]/run-reconcile-button.tsx](../../../src/app/items/[id]/run-reconcile-button.tsx). Unchanged except its result now carries the new `suggested_rationale` / `flag_state` / `final_rationale` defaults.

Add `generate_email` to the `DecisionLogEntry.action` union (see "decision_log JSON shape" below).

## Audit-trail / feedback-loop story (for the demo)

No special UI for this. The `decision_log` jsonb on every reviewed row contains the full trail: defaulted flag states, every override, every rationale edit, the submit event. During the demo we say (loosely):

> "Every override here is a labeled training example. Patterns across many reviewers — same field, same correction — become candidate tier-2 rules the system applies automatically next time. We're not building the rule-learner today, but the data is captured from day one."

This is point 4 of the brainstorm conclusion: audit-only feedback loop, narrated.

## Out of band: CLAUDE.md drift

CLAUDE.md's "data model" section describes a single denormalized table. The actual schema is four tables. As part of this work, update the relevant section so the doc matches reality. Small, but worth doing in the same PR so the docs don't keep accumulating drift.

## File-level summary of changes

New files:

- `supabase/migrations/2026MMDDhhmmss_review_flow.sql` — three new columns on `reconciliation_items`, extended status constraint.
- `src/lib/email/index.ts` — public `draftEmail` / `renderTemplate` surface.
- `src/lib/email/prompts.ts` — system prompt + user-prompt builder.
- `src/lib/email/draft.ts` — OpenAI call.
- `src/lib/email/template.ts` — deterministic fallback used for the draft preview state and on LLM failure.
- `src/lib/email/types.ts` — `EmailDraftInput` / `EmailDraftResult`.
- `src/app/items/[id]/actions.ts` — `toggleFlag`, `editRationale`, `generateEmail`, `submitReview` server actions.

Modified files:

- `src/lib/reconcile/types.ts` — `DiscrepancyBase` gains `suggested_rationale`; flag/rationale fields added to `FieldDiscrepancy` / `NarrativeDiscrepancy`; `DecisionLogEntry.action` union extended.
- `src/lib/reconcile/prompts.ts` — system prompt extended.
- `src/lib/reconcile/llm.ts` — zod schema updated.
- `src/lib/reconcile/rules.ts` — templated rationale on rule-emitted findings.
- `src/lib/reconcile/index.ts` — default flag_state / final_rationale post-process.
- `src/app/page.tsx` — sort by `created_at`; status badge handling; time-to-completion; copy-markdown button.
- `src/app/items/[id]/page.tsx` — replace disabled Accept/Reject/Escalate with `Include in email` toggle + rationale textarea; collapse auto-resolved into its own section; add right-column email preview; add submit footer.
- `src/lib/db/database.types.ts` — regenerated via `pnpm generate` after migration.
- `CLAUDE.md` — "data model" section updated to reflect four-table schema.

## What we explicitly skip (and will say so during the build)

- Sending email; we only copy.
- Reopening a reviewed item.
- Multi-reviewer / assignment / locking.
- An explicit "promote this to an auto-rule" affordance.
- Editing extracted values inline.
- Auth.

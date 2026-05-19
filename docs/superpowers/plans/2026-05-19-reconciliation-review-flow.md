# Reconciliation Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reviewer-facing queue + review screen that turns reconciliation findings into a carrier-addressed, LLM-drafted markdown email, with every decision logged as the audit trail.

**Architecture:** Two-screen app (`/` queue, `/items/[id]` review) on the existing Next.js 16 + Supabase + ShadCN scaffold. Discrepancies live as JSON on `reconciliation_items`; per-discrepancy include/rationale state is added inside that JSON. A new `src/lib/email/` module mirrors `src/lib/reconcile/` and provides both a deterministic template renderer (for the live preview state) and an LLM-drafted version (`gpt-5.4-mini`, with a template fallback if the API key is missing). Server actions handle every mutation and append to `decision_log`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres, `@ai-sdk/openai`, zod, Tailwind + ShadCN, Biome, pnpm.

**Source spec:** [docs/superpowers/specs/2026-05-19-reconciliation-review-flow-design.md](../specs/2026-05-19-reconciliation-review-flow-design.md)

## How to read this plan

**No tests.** The user has explicitly opted out of TDD for this prototype. Every task verifies via type-checks (`pnpm check`), lint (`pnpm lint`), build (`pnpm build`), or an end-to-end smoke through `pnpm dev`. Do not add Vitest tests even though the harness exists.

**Parallel execution.** Many tasks are independent of each other so multiple sessions/agents can pick them up at once. Each task has a **Depends on:** line listing predecessor task numbers. Tasks with no predecessors can start immediately. The intended waves:

- **Wave 1** (no deps): Tasks 1, 2, 6, 14 — start in parallel.
- **Wave 2:** Task 3 (after 2), Task 4 (after 2), Task 7 (after 6), Task 9 (after 1).
- **Wave 3:** Task 5 (after 3 + 4).
- **Wave 4:** Task 8 (after 1 + 5 + 7), Task 10 (after 5).
- **Wave 5:** Tasks 11, 12, 13 in parallel (after 8 + 10).

**Conventions.** Each task should be committed when it passes its verify command. Use a conventional commit prefix (`feat:`, `chore:`, `docs:`). Commit body should narrate non-obvious decisions per CLAUDE.md.

---

## Task 1: Schema migration — reviewed columns + extended status

**Goal:** Add `reviewed_at`, `reviewed_by`, `email_markdown` columns to `reconciliation_items` and widen the `status` check constraint to include `'reviewed'`. Regenerate the Supabase TypeScript types.

**Depends on:** none.

**Files:**
- Create: `supabase/migrations/20260520000000_review_flow.sql`
- Modify (generated): `src/lib/db/database.types.ts`

**Acceptance Criteria:**
- [ ] Migration applies cleanly via `pnpm db:reset` against a fresh local Supabase.
- [ ] `\d+ reconciliation_items` shows the three new columns and a status check that includes `'reviewed'`.
- [ ] `src/lib/db/database.types.ts` references the new columns under `reconciliation_items.Row`.

**Verify:** `pnpm db:reset && pnpm db:types && pnpm check`

**Steps:**

- [ ] **Step 1: Create the migration file.**

Path: `supabase/migrations/20260520000000_review_flow.sql`

```sql
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
```

- [ ] **Step 2: Apply the migration and regenerate types.**

Run: `pnpm db:reset`
Expected: migration runs, seed completes, queue still has 5 items.

Run: `pnpm db:types`
Expected: `src/lib/db/database.types.ts` regenerated, includes `email_markdown: string | null`, `reviewed_at: string | null`, `reviewed_by: string | null` on the `reconciliation_items` row type.

- [ ] **Step 3: Type-check the project.**

Run: `pnpm check`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/20260520000000_review_flow.sql src/lib/db/database.types.ts
git commit -m "feat(schema): add reviewed_at, reviewed_by, email_markdown + 'reviewed' status"
```

---

## Task 2: Extend Discrepancy + DecisionLogEntry types

**Goal:** Widen the in-memory shape of a discrepancy to carry the reviewer's include-in-email flag and rationale, and widen `DecisionLogEntry.action` to cover the new events.

**Depends on:** none.

**Files:**
- Modify: `src/lib/reconcile/types.ts`

**Acceptance Criteria:**
- [ ] `DiscrepancyBase` carries `suggested_rationale`, `final_rationale`, and `flag_state`.
- [ ] `DecisionLogEntry.action` includes `'include_in_email' | 'exclude_from_email' | 'rationale_edit' | 'generate_email' | 'submit'`.
- [ ] Existing actions (`'accept' | 'reject' | 'edit' | 'escalate' | 'auto_resolve' | 'comment'`) are retained.

**Verify:** `pnpm check`

**Steps:**

- [ ] **Step 1: Update `DiscrepancyBase` and `DecisionLogEntry` in `src/lib/reconcile/types.ts`.**

Replace the existing `DiscrepancyBase` (lines ~62–69) with:

```ts
interface DiscrepancyBase {
  id: string;
  tier: DiscrepancyTier;
  summary: string;
  detail?: string;
  source: 'rules' | 'llm';
  confidence?: number;
  /**
   * Carrier-facing one-or-two sentences explaining why we want this item
   * called out in the follow-up email. The reconcile pipeline populates
   * this on every finding: LLM-emitted for residue fields and narratives;
   * templated in `rules.ts` for cosmetic / auto_resolved.
   */
  suggested_rationale: string;
  /** Reviewer-edited rationale. Starts equal to suggested_rationale. */
  final_rationale: string;
  /**
   * Defaults per tier: material / ambiguous / out_of_distribution → 'include';
   * cosmetic / auto_resolved → 'exclude'. The reviewer can flip it either way
   * from the detail screen.
   */
  flag_state: 'include' | 'exclude';
}
```

Replace the existing `DecisionLogEntry` (lines ~108–115) with:

```ts
export interface DecisionLogEntry {
  at: string; // ISO timestamp
  actor: 'reviewer' | 'system';
  action:
    | 'accept'              // legacy per-discrepancy approval — unused in v1
    | 'reject'              // legacy per-discrepancy reject — unused in v1
    | 'edit'                // legacy generic edit — unused in v1
    | 'escalate'            // legacy escalate — unused in v1
    | 'auto_resolve'        // system-emitted on rules pre-pass
    | 'comment'             // free-text note
    | 'include_in_email'    // flag flipped on
    | 'exclude_from_email'  // flag flipped off
    | 'rationale_edit'      // final_rationale changed
    | 'generate_email'      // LLM draft produced (or template fallback)
    | 'submit';             // review finalized, email_markdown saved
  discrepancy_id?: string;
  note?: string;
}
```

- [ ] **Step 2: Type-check.**

Run: `pnpm check`
Expected: errors will surface in callers that construct discrepancies without the new required fields (`rules.ts`, `llm.ts`). Those are fixed in Tasks 3 + 4. Confirm errors are only in those files.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/reconcile/types.ts
git commit -m "feat(types): widen Discrepancy + DecisionLogEntry for review flow"
```

> Note: typecheck will fail at `rules.ts` and `llm.ts` until Tasks 3 and 4 land. Don't gate the commit on a clean `pnpm check` here — confirm the failures are isolated to those files and move on.

---

## Task 3: Templated rationales + flag defaults in rules pre-pass

**Goal:** Update `src/lib/reconcile/rules.ts` so every rule-emitted finding carries a templated `suggested_rationale`, with `final_rationale` mirroring it and `flag_state = 'exclude'`.

**Depends on:** Task 2.

**Files:**
- Modify: `src/lib/reconcile/rules.ts`

**Acceptance Criteria:**
- [ ] Every `Discrepancy` returned from `runRules` carries `suggested_rationale`, `final_rationale`, and `flag_state: 'exclude'`.
- [ ] Cosmetic findings use a normalization-specific template (e.g., "Whitespace/punctuation difference only — treated as equivalent.").
- [ ] Auto-resolved findings (date-format match, sub-tolerance numeric drift) use a template that names the rule (e.g., "Same date in different format; no policy change.").
- [ ] `pnpm check` passes (assuming Task 2 has landed).

**Verify:** `pnpm check && pnpm lint`

**Steps:**

- [ ] **Step 1: Read `src/lib/reconcile/rules.ts` end-to-end** to find every site that constructs a `Discrepancy`. (There should be one or two helper functions that return the `cosmetic` and `auto_resolved` tiers — they need to be extended.)

- [ ] **Step 2: Add a small helper at the top of the file:**

```ts
function withReviewDefaults(
  d: Omit<Discrepancy, 'suggested_rationale' | 'final_rationale' | 'flag_state'>,
  suggested_rationale: string,
): Discrepancy {
  return {
    ...d,
    suggested_rationale,
    final_rationale: suggested_rationale,
    flag_state: 'exclude',
  } as Discrepancy;
}
```

- [ ] **Step 3: Wrap every existing construction site through `withReviewDefaults`, passing a rationale string that names the rule.** Examples:

```ts
// cosmetic — string normalization match
return withReviewDefaults(
  {
    id: makeId(field),
    kind: 'field',
    tier: 'cosmetic',
    source: 'rules',
    summary: `${field} normalized equivalent`,
    field,
    system_value: sor[field],
    extracted_value: ext.fields?.[field]?.value,
  },
  `Whitespace, casing, or punctuation difference only. Treated as equivalent ("${normalize(sor[field])}" vs "${normalize(ext.fields?.[field]?.value)}").`,
);

// auto_resolved — sub-tolerance numeric drift
return withReviewDefaults(
  {
    /* …existing fields… */
    tier: 'auto_resolved',
  },
  `Numeric difference under tolerance (${diff} vs threshold ${tolerance}). No policy change.`,
);

// auto_resolved — equivalent date format
return withReviewDefaults(
  {
    /* …existing fields… */
    tier: 'auto_resolved',
  },
  `Same date written in a different format (${rawSor} vs ${rawExt}). No policy change.`,
);
```

Use whatever variable names already exist in the file — the names above are illustrative. Goal: every `return` of a `Discrepancy` from `rules.ts` goes through `withReviewDefaults`.

- [ ] **Step 4: Type-check + lint.**

Run: `pnpm check`
Expected: this file is clean. `llm.ts` may still fail until Task 4 lands.

Run: `pnpm lint`
Expected: no new findings.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/reconcile/rules.ts
git commit -m "feat(reconcile): rule-emitted findings carry templated rationale + exclude default"
```

---

## Task 4: LLM seam — elicit suggested_rationale

**Goal:** Extend the reconcile LLM prompt and zod schema so the model emits a carrier-facing `suggested_rationale` per finding. Update the no-key fallback stub similarly.

**Depends on:** Task 2.

**Files:**
- Modify: `src/lib/reconcile/prompts.ts`
- Modify: `src/lib/reconcile/llm.ts`

**Acceptance Criteria:**
- [ ] System prompt instructs the model to emit a `suggested_rationale` per finding, 1–2 sentences, carrier-facing tone.
- [ ] zod schema requires `suggested_rationale: z.string()` on both `fieldFindings` and `narrativeFindings`.
- [ ] No-key fallback stub returns `suggested_rationale: 'Low-confidence extraction; please confirm the value on the source document.'` (or similar) and sets `final_rationale` + `flag_state` to mirror Task 5's post-process defaults — see Task 5 if uncertain; the index.ts post-process is the canonical place to set those, so the stub can leave them out and rely on Task 5.
- [ ] `pnpm check` passes (assuming Tasks 2 + 3 have landed).

**Verify:** `pnpm check`

**Steps:**

- [ ] **Step 1: Update the system prompt** in `src/lib/reconcile/prompts.ts`. Append after the existing rules:

```
  6. For every finding (in either array), include a "suggested_rationale":
     a one-or-two-sentence string written as if drafting a note to the
     carrier's underwriter — neutral, factual, asks for clarification or
     correction rather than asserts fault. Examples:
       - "The policy number on the renewal differs from the placement on
         file; please confirm the correct value."
       - "An additional exclusion appears in the cover letter that is not
         in the structured schedule; please clarify whether it is intended
         to apply."
     Do not propose a course of action. Do not include greetings, sign-offs,
     or list markers — just the sentence(s).
```

- [ ] **Step 2: Update the zod schema in `src/lib/reconcile/llm.ts`** so both finding shapes require `suggested_rationale`. Add `suggested_rationale: z.string()` to the field-finding object schema and the narrative-finding object schema.

- [ ] **Step 3: Update the no-key fallback** that returns ambiguous findings for every residue field. Wherever it constructs a finding, include `suggested_rationale` — e.g., `'Extraction confidence was low; please confirm the value on the source document.'`. Leave `final_rationale` and `flag_state` unset here — Task 5's post-process fills them.

- [ ] **Step 4: Update the mapping from validated zod output to the internal `Discrepancy` shape** so `suggested_rationale` flows through. Do NOT set `final_rationale` or `flag_state` in this file; those are Task 5's job (single source of truth for defaults).

- [ ] **Step 5: Type-check.**

Run: `pnpm check`
Expected: clean once Tasks 2 + 3 are merged.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/reconcile/prompts.ts src/lib/reconcile/llm.ts
git commit -m "feat(reconcile): elicit carrier-facing suggested_rationale from LLM"
```

---

## Task 5: Reconcile post-process — flag + rationale defaults

**Goal:** In `src/lib/reconcile/index.ts`, after merging rule + LLM findings, ensure every discrepancy has `flag_state`, `final_rationale`, and a stable `id` regardless of which path produced it.

**Depends on:** Tasks 3, 4.

**Files:**
- Modify: `src/lib/reconcile/index.ts`

**Acceptance Criteria:**
- [ ] Every discrepancy returned by `reconcile()` has `flag_state` set: `'include'` for `material | ambiguous | out_of_distribution`, `'exclude'` for `cosmetic | auto_resolved`.
- [ ] Every discrepancy has `final_rationale` populated (defaults to `suggested_rationale` if not already set).
- [ ] Every discrepancy has a non-empty `id` (use the existing helper or fall back to `crypto.randomUUID()`).
- [ ] An end-to-end run via `POST /api/reconcile { item_id: <seed-row-id> }` succeeds and writes a `discrepancies` jsonb with all three fields populated on every entry.

**Verify:** `pnpm check && pnpm build`

**Steps:**

- [ ] **Step 1: Add a `withDefaults` helper at the bottom of `src/lib/reconcile/index.ts`:**

```ts
const INCLUDE_BY_TIER: Record<Discrepancy['tier'], 'include' | 'exclude'> = {
  out_of_distribution: 'include',
  material: 'include',
  ambiguous: 'include',
  auto_resolved: 'exclude',
  cosmetic: 'exclude',
};

function withDefaults(d: Discrepancy): Discrepancy {
  return {
    ...d,
    id: d.id || crypto.randomUUID(),
    final_rationale: d.final_rationale ?? d.suggested_rationale,
    flag_state: d.flag_state ?? INCLUDE_BY_TIER[d.tier],
  };
}
```

- [ ] **Step 2: Apply it to every finding before returning.** Modify the existing `reconcile` function so the merged array is mapped through `withDefaults`:

```ts
const all = [...trivial, ...llmFindings]
  .map(withDefaults)
  .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
```

- [ ] **Step 3: Run the type-check and a full build.**

Run: `pnpm check`
Expected: clean.

Run: `pnpm build`
Expected: builds successfully (this catches any caller misalignment).

- [ ] **Step 4: Smoke-test reconcile against a seeded row.**

Run: `pnpm db:reset && pnpm dev` (in another shell), then in a third shell:

```bash
curl -s -X POST http://localhost:3000/api/reconcile \
  -H 'content-type: application/json' \
  -d "{\"item_id\":\"$(psql 'postgres://postgres:postgres@127.0.0.1:54322/postgres' -At -c "select id from reconciliation_items limit 1")\"}" | jq '.discrepancies[0] | {id, tier, flag_state, suggested_rationale, final_rationale}'
```

Expected: every key populated; no `null` or missing fields.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/reconcile/index.ts
git commit -m "feat(reconcile): default flag_state + final_rationale on every finding"
```

---

## Task 6: Email module — types + deterministic template

**Goal:** Create the new `src/lib/email/` module with the shared types and a pure-function markdown template renderer. This is the live-preview path and the LLM fallback path.

**Depends on:** none. (Defines its own types and consumes nothing from `reconcile`.)

**Files:**
- Create: `src/lib/email/types.ts`
- Create: `src/lib/email/template.ts`

**Acceptance Criteria:**
- [ ] `EmailDraftInput` and `EmailDraftResult` types are exported from `src/lib/email/types.ts`.
- [ ] `renderTemplate(input: EmailDraftInput): string` returns a complete markdown document with a `Subject:` first line, salutation, numbered list, optional reviewer-notes block, and sign-off.
- [ ] `pnpm check` passes.

**Verify:** `pnpm check && pnpm lint`

**Steps:**

- [ ] **Step 1: Create `src/lib/email/types.ts`:**

```ts
/**
 * Inputs the email-drafting seam receives. Built by the server action
 * from the current row state — only `flag_state === 'include'`
 * discrepancies are passed; rationales are the reviewer's final values.
 */
export interface EmailDraftInput {
  account: { id: string; name: string };
  policy: {
    number: string;
    carrier: string;
    type: string;
    effective_date: string | null;
  };
  document: {
    doc_type: string;
    filename: string;
    /** ISO date if the document carries one (extracted_at, or a parsed date). */
    date?: string;
  };
  items: EmailItem[];
  /** Optional free-text block appended below the bulleted findings. */
  reviewer_notes?: string;
  /** Display name for the sign-off. Single mock user in v1. */
  reviewer_name: string;
}

export interface EmailItem {
  /** Field name for field-findings; section title for narrative findings. */
  label: string;
  /** Omitted for narrative findings. */
  system_value?: string;
  extracted_value?: string;
  page?: number;
  /** Reviewer's final_rationale, post any edits. */
  rationale: string;
}

export interface EmailDraftResult {
  markdown: string;
  source: 'llm' | 'template';
}
```

- [ ] **Step 2: Create `src/lib/email/template.ts`:**

```ts
import type { EmailDraftInput } from './types';

/**
 * Deterministic fallback renderer. Used for the draft-preview state in the
 * UI (no LLM call per keystroke) and as the safe fallback when the email
 * LLM call fails or `OPENAI_API_KEY` is unset.
 */
export function renderTemplate(input: EmailDraftInput): string {
  const { account, policy, document, items, reviewer_notes, reviewer_name } = input;

  const subject = `Subject: Renewal review — ${account.name} / ${policy.number}`;
  const opener = [
    `Hi ${policy.carrier} team,`,
    '',
    `We've reviewed the ${document.doc_type} for ${account.name} (account ${account.id})`,
    `against our records${policy.effective_date ? ` for policy ${policy.number} effective ${policy.effective_date}` : ''}`,
    `and have the following items to clarify before we can confirm placement:`,
  ].join(' ').replace(/\s+/g, ' ');

  const bullets = items.length
    ? items.map((item, i) => formatItem(item, i + 1)).join('\n\n')
    : '_No items flagged for clarification._';

  const notesBlock = reviewer_notes?.trim()
    ? `\n\nAdditional notes:\n${reviewer_notes.trim()}\n`
    : '';

  const signoff = `Thanks,\n${reviewer_name}`;

  return [subject, '', opener, '', bullets, notesBlock, '', signoff].join('\n');
}

function formatItem(item: EmailItem, n: number): string {
  const lines: string[] = [`${n}. **${item.label}** — ${item.rationale}`];
  if (item.system_value !== undefined) {
    lines.push(`   - System of record: ${item.system_value || '—'}`);
  }
  if (item.extracted_value !== undefined) {
    lines.push(`   - Document: ${item.extracted_value || '—'}`);
  }
  if (typeof item.page === 'number') {
    lines.push(`   - Source: p${item.page}`);
  }
  return lines.join('\n');
}

import type { EmailItem } from './types';
```

(Imports at top; move the `import type` if Biome complains.)

- [ ] **Step 3: Type-check + lint.**

Run: `pnpm check && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/email/types.ts src/lib/email/template.ts
git commit -m "feat(email): add EmailDraftInput types + deterministic template renderer"
```

---

## Task 7: Email module — LLM draft path + public surface

**Goal:** Add the LLM-drafted email path. `draftEmail(input)` calls `gpt-5.4-mini`, falls back to the template on missing key or failure, and exposes both via `src/lib/email/index.ts`.

**Depends on:** Task 6.

**Files:**
- Create: `src/lib/email/prompts.ts`
- Create: `src/lib/email/draft.ts`
- Create: `src/lib/email/index.ts`

**Acceptance Criteria:**
- [ ] `draftEmail(input: EmailDraftInput): Promise<EmailDraftResult>` returns `{ markdown, source: 'llm' }` when the OpenAI call succeeds.
- [ ] Returns `{ markdown: renderTemplate(input), source: 'template' }` when `OPENAI_API_KEY` is missing or the call throws.
- [ ] Public exports from `src/lib/email/index.ts`: `draftEmail`, `renderTemplate`, plus the type re-exports.
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm check && pnpm build`

**Steps:**

- [ ] **Step 1: Create `src/lib/email/prompts.ts`:**

```ts
import type { EmailDraftInput } from './types';

export const EMAIL_SYSTEM_PROMPT = `You are drafting a professional email
from a brokerage account manager to an insurance carrier's underwriter.
Goal: ask the carrier to clarify or correct each listed item before
placement is confirmed.

Hard rules:
  1. DO NOT introduce new findings, add items, or invent details. The
     "items" array is the complete set you may discuss.
  2. DO NOT change the meaning of any item's rationale. You may tighten
     wording but the substance must be preserved.
  3. DO NOT remove items.
  4. You MAY reorder items if it improves readability — material first,
     then ambiguous; otherwise preserve given order.
  5. Tone: professional, neutral, factual. Ask, do not accuse.

Output format (markdown only, no fences):
  - First line:    Subject: <one-line subject>
  - Blank line
  - Salutation:    "Hi <carrier> team,"
  - Blank line
  - Opening sentence referencing the account, policy, and document.
  - Blank line
  - Numbered list. Each item:
      <n>. **<label>** — <rationale>
         - System of record: <system_value>   (omit line if absent)
         - Document: <extracted_value>         (omit line if absent)
         - Source: p<page>                     (omit line if absent)
  - Blank line
  - Optional "Additional notes:" paragraph if reviewer_notes is non-empty.
  - Blank line
  - Sign-off: "Thanks,\\n<reviewer_name>"`;

export function buildEmailUserPrompt(input: EmailDraftInput): string {
  return [
    'Draft the email per the rules. Inputs:',
    '',
    JSON.stringify(input, null, 2),
  ].join('\n');
}
```

- [ ] **Step 2: Create `src/lib/email/draft.ts`:**

```ts
import 'server-only';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env';
import { EMAIL_SYSTEM_PROMPT, buildEmailUserPrompt } from './prompts';
import { renderTemplate } from './template';
import type { EmailDraftInput, EmailDraftResult } from './types';

const MODEL = 'gpt-5.4-mini';

export async function draftEmail(input: EmailDraftInput): Promise<EmailDraftResult> {
  if (!env.OPENAI_API_KEY) {
    return { markdown: renderTemplate(input), source: 'template' };
  }
  try {
    const { text } = await generateText({
      model: openai(MODEL),
      system: EMAIL_SYSTEM_PROMPT,
      prompt: buildEmailUserPrompt(input),
    });
    const cleaned = text.trim();
    if (!cleaned) {
      return { markdown: renderTemplate(input), source: 'template' };
    }
    return { markdown: cleaned, source: 'llm' };
  } catch (err) {
    console.error('[email] draftEmail failed; falling back to template', err);
    return { markdown: renderTemplate(input), source: 'template' };
  }
}
```

- [ ] **Step 3: Create `src/lib/email/index.ts`:**

```ts
export { draftEmail } from './draft';
export { renderTemplate } from './template';
export type {
  EmailDraftInput,
  EmailDraftResult,
  EmailItem,
} from './types';
```

- [ ] **Step 4: Type-check + build.**

Run: `pnpm check`
Expected: clean.

Run: `pnpm build`
Expected: builds successfully.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/email/prompts.ts src/lib/email/draft.ts src/lib/email/index.ts
git commit -m "feat(email): LLM draft path with template fallback"
```

---

## Task 8: Server actions for the review flow

**Goal:** Add the four server actions the detail screen needs: `toggleFlag`, `editRationale`, `generateEmail`, `submitReview`. Each one mutates `reconciliation_items` and appends to `decision_log`.

**Depends on:** Tasks 1, 5, 7.

**Files:**
- Create: `src/app/items/[id]/actions.ts`
- Create: `src/lib/email/build-input.ts` (helper that turns a row into `EmailDraftInput`)

**Acceptance Criteria:**
- [ ] `toggleFlag(itemId, discrepancyId, nextState)` updates the matching discrepancy's `flag_state`, appends an `include_in_email` or `exclude_from_email` event, auto-sets `status = 'in_review'` if currently `'open'`, sets `email_markdown = null` to invalidate any stale draft, calls `revalidatePath('/items/[id]', 'page')` and `revalidatePath('/')`.
- [ ] `editRationale(itemId, discrepancyId, nextRationale)` updates `final_rationale`, appends `rationale_edit`, same status/invalidate behavior.
- [ ] `generateEmail(itemId)` builds `EmailDraftInput` from the row, calls `draftEmail`, persists `email_markdown`, appends `generate_email` with `note` = `source`, revalidates.
- [ ] `submitReview(itemId, editedMarkdown?)` persists provided markdown (or generates if none), sets `reviewed_at`, `reviewed_by`, `status = 'reviewed'`, appends `submit`. Returns nothing; client redirects to `/`.
- [ ] All four actions use the service-role Supabase client from `@/lib/supabase/admin` (already in the scaffold; bypasses RLS for the single-user prototype).

**Verify:** `pnpm check && pnpm build`

**Steps:**

- [ ] **Step 1: Create `src/lib/email/build-input.ts`** — a small helper that turns a `reconciliation_items` row (plus its joined policy/account/document) into `EmailDraftInput`, filtering to `flag_state === 'include'`:

```ts
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
```

- [ ] **Step 2: Create `src/app/items/[id]/actions.ts`:**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { draftEmail } from '@/lib/email';
import { buildEmailInput } from '@/lib/email/build-input';
import type { DecisionLogEntry, Discrepancy } from '@/lib/reconcile';
import { buildSor } from '@/lib/sor';
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
  const discrepancies = (item.discrepancies ?? []) as Discrepancy[];
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
      discrepancies: updated as unknown as object,
      decision_log: appendEvent(item.decision_log, entry) as unknown as object,
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
  const discrepancies = (item.discrepancies ?? []) as Discrepancy[];
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
      discrepancies: updated as unknown as object,
      decision_log: appendEvent(item.decision_log, entry) as unknown as object,
      status: nextStatus(item.status, 'in_review'),
      email_markdown: null,
    })
    .eq('id', itemId);
  revalidateBoth(itemId);
}

export async function generateEmail(itemId: string): Promise<{ markdown: string; source: 'llm' | 'template' }> {
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
    discrepancies: (item.discrepancies ?? []) as Discrepancy[],
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
      decision_log: appendEvent(item.decision_log, entry) as unknown as object,
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
      discrepancies: (item.discrepancies ?? []) as Discrepancy[],
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
      decision_log: appendEvent(item.decision_log, submitEntry) as unknown as object,
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
```

> Note: `buildSor` is imported above for symmetry with the existing detail page, but isn't strictly needed inside the actions; the email input is built directly from the policy + account rows. Remove the import if Biome flags it.

- [ ] **Step 3: Type-check + build.**

Run: `pnpm check && pnpm build`
Expected: clean. If `createAdminClient` is named differently (`createClient` from `@/lib/supabase/admin` or similar), match the actual export.

- [ ] **Step 4: Commit.**

```bash
git add src/app/items/[id]/actions.ts src/lib/email/build-input.ts
git commit -m "feat(actions): toggleFlag, editRationale, generateEmail, submitReview"
```

---

## Task 9: Queue screen — FIFO, status badge, time-to-completion

**Goal:** Rework `src/app/page.tsx` so it sorts by `created_at` (FIFO), shows the new `reviewed` status, renders time-to-completion for reviewed items, and offers a copy-markdown button on reviewed rows.

**Depends on:** Task 1 (needs `reviewed_at` + `email_markdown` in the type and in the select). Does NOT depend on later tasks; the existing seed has no reviewed rows yet, but the code paths can be exercised by manually flipping a row.

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/queue-row-actions.tsx` (client component for the copy button)

**Acceptance Criteria:**
- [ ] Queue sorts pending items first (FIFO ascending by `created_at`), reviewed items after (also FIFO).
- [ ] Each row shows a status badge: `Pending`, `In review`, or `Reviewed`.
- [ ] Reviewed rows show a time-to-completion string (e.g., `"2h 14m"`) computed from `reviewed_at - created_at`.
- [ ] Reviewed rows show a "Copy email" button that copies `email_markdown` to the clipboard.
- [ ] Reviewed rows are visually muted (e.g., `opacity-60`).

**Verify:** `pnpm build && pnpm dev` then visit `http://localhost:3000`.

**Steps:**

- [ ] **Step 1: Update the select in `src/app/page.tsx`** to include `created_at, reviewed_at, email_markdown`:

```ts
const { data: items, error } = await supabase
  .from('reconciliation_items')
  .select(
    `
    id, reference, status, severity, due_at, discrepancies, updated_at,
    created_at, reviewed_at, email_markdown,
    document:documents!inner ( doc_type, filename ),
    policy:policies!inner (
      policy_number, carrier,
      account:accounts!inner ( account_name )
    )
  `,
  )
  .order('created_at', { ascending: true });
```

- [ ] **Step 2: Split items into pending + reviewed groups in-memory.** Render pending first, then a divider, then reviewed (muted).

```tsx
const sorted = items ?? [];
const pending = sorted.filter((i) => i.status !== 'reviewed');
const reviewed = sorted.filter((i) => i.status === 'reviewed');
```

- [ ] **Step 3: Add a `formatDuration(from, to)` helper at the bottom of `src/app/page.tsx`:**

```ts
function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return '—';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && mins) parts.push(`${mins}m`);
  return parts.join(' ') || '<1m';
}
```

- [ ] **Step 4: Add a `STATUS_LABEL` map and update the badge in the row.**

```ts
const STATUS_LABEL: Record<string, string> = {
  open: 'Pending',
  in_review: 'In review',
  reviewed: 'Reviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  escalated: 'Escalated',
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700',
  in_review: 'bg-sky-100 text-sky-900',
  reviewed: 'bg-emerald-100 text-emerald-900',
};
```

Replace the existing status `<span>` with `STATUS_LABEL[item.status]` and `STATUS_TONE[item.status]`. For reviewed rows, append the time-to-completion string after the label.

- [ ] **Step 5: Apply visual muting to reviewed rows** (add `opacity-60` class).

- [ ] **Step 6: Create `src/app/queue-row-actions.tsx`** for the copy-to-clipboard button:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyEmailButton({ markdown }: { markdown: string | null }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  if (!markdown) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(markdown);
          setState('copied');
          setTimeout(() => setState('idle'), 1500);
        } catch {
          setState('error');
          setTimeout(() => setState('idle'), 2000);
        }
      }}
    >
      {state === 'copied' ? 'Copied!' : state === 'error' ? 'Copy failed' : 'Copy email'}
    </Button>
  );
}
```

Render `<CopyEmailButton markdown={item.email_markdown} />` next to the Open link in the row JSX for reviewed items.

- [ ] **Step 7: Verify in the browser.**

Run: `pnpm dev`
Visit: `http://localhost:3000`
Expected: all seeded items appear as Pending, sorted by `created_at`. No reviewed rows yet (none submitted). Manually update one row to test:

```bash
psql 'postgres://postgres:postgres@127.0.0.1:54322/postgres' -c "update reconciliation_items set status='reviewed', reviewed_at=now() - interval '2 hour 14 minute', email_markdown='## Test email\nHello.' where id = (select id from reconciliation_items limit 1);"
```

Refresh: that row now shows `Reviewed · 2h 14m`, muted, with a `Copy email` button that puts the markdown on the clipboard.

- [ ] **Step 8: Commit.**

```bash
git add src/app/page.tsx src/app/queue-row-actions.tsx
git commit -m "feat(queue): FIFO sort, reviewed badge, time-to-completion, copy email"
```

---

## Task 10: Review page — extract subcomponents

**Goal:** Split the existing review page into small client/server components so Tasks 11/12/13 can be worked on in parallel without merge conflicts. No behavior change in this task — pure refactor that introduces empty/passthrough subcomponents.

**Depends on:** Task 5 (consumes the new discrepancy fields).

**Files:**
- Modify: `src/app/items/[id]/page.tsx`
- Create: `src/app/items/[id]/discrepancy-cards.tsx` (initial stub — renders existing card markup)
- Create: `src/app/items/[id]/email-panel.tsx` (initial stub — renders the existing "Field findings" section as a placeholder)
- Create: `src/app/items/[id]/submit-footer.tsx` (initial stub — renders a disabled button)

**Acceptance Criteria:**
- [ ] The existing review page renders exactly as it does today (same SOR/extracted side-by-side, same unparsed sections, same finding cards).
- [ ] `discrepancy-cards.tsx`, `email-panel.tsx`, and `submit-footer.tsx` each exist with the appropriate `'use client'` directive (or none, for server components) and receive props they need from the page.
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm build && pnpm dev` — open any item, confirm visual parity.

**Steps:**

- [ ] **Step 1: Read `src/app/items/[id]/page.tsx` end-to-end.** Identify three regions to extract:
  - The two finding sections (`FieldFindingCard` + `NarrativeFindingCard` loops) → `discrepancy-cards.tsx`
  - A new right-column placeholder → `email-panel.tsx`
  - A new sticky footer placeholder → `submit-footer.tsx`

- [ ] **Step 2: Create `src/app/items/[id]/discrepancy-cards.tsx` as a client component.** Move the `FieldFindingCard` and `NarrativeFindingCard` functions and their `TIER_TONE` constant into this file. Export a default `DiscrepancyCards({ itemId, discrepancies })` that renders the two sections (material vs. handled-automatically) exactly as the page currently renders them — Task 11 will introduce the actual sections + include/rationale UI. For now, just keep behavior identical (one section labeled "Field findings", one labeled "Narrative findings"). Pass `itemId` even though it's unused yet — Task 11 will need it.

```tsx
'use client';

import type { Discrepancy, FieldDiscrepancy, NarrativeDiscrepancy } from '@/lib/reconcile';
// ...TIER_TONE constant lives here...
// ...FieldFindingCard, NarrativeFindingCard live here...

export interface DiscrepancyCardsProps {
  itemId: string;
  discrepancies: Discrepancy[];
}

export function DiscrepancyCards({ itemId, discrepancies }: DiscrepancyCardsProps) {
  const fieldFindings = discrepancies.filter(
    (d): d is FieldDiscrepancy => d.kind === 'field',
  );
  const narrativeFindings = discrepancies.filter(
    (d): d is NarrativeDiscrepancy => d.kind === 'narrative',
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Field findings{' '}
          <span className="text-xs font-normal text-muted-foreground">
            ({fieldFindings.length})
          </span>
        </h2>
        {discrepancies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Not yet compared. Click <strong>Run reconcile</strong> to populate.
          </p>
        )}
        {fieldFindings.map((d) => (
          <FieldFindingCard key={d.id} d={d} />
        ))}
      </section>
      {narrativeFindings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">
            Narrative findings{' '}
            <span className="text-xs font-normal text-muted-foreground">
              ({narrativeFindings.length}) — LLM-only
            </span>
          </h2>
          {narrativeFindings.map((d) => (
            <NarrativeFindingCard key={d.id} d={d} />
          ))}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/items/[id]/email-panel.tsx` as a client component stub.** Renders a placeholder block ("Email preview will appear here") in the right column. Task 12 fills it in.

```tsx
'use client';

import type { Discrepancy } from '@/lib/reconcile';

export interface EmailPanelProps {
  itemId: string;
  initialMarkdown: string | null;
  discrepancies: Discrepancy[];
  // The page passes a pre-rendered template string so the panel doesn't need
  // to know about row-shaping. Task 12 wires this up properly.
  templatePreview: string;
}

export function EmailPanel({ initialMarkdown, templatePreview }: EmailPanelProps) {
  return (
    <aside className="rounded-md border p-3 text-xs text-muted-foreground">
      <p className="mb-2 font-medium text-foreground">Email (preview)</p>
      <pre className="whitespace-pre-wrap font-mono">
        {initialMarkdown ?? templatePreview}
      </pre>
    </aside>
  );
}
```

- [ ] **Step 4: Create `src/app/items/[id]/submit-footer.tsx` as a client component stub.**

```tsx
'use client';

import { Button } from '@/components/ui/button';

export interface SubmitFooterProps {
  itemId: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
}

export function SubmitFooter({ totalDiscrepancies, includedCount, hasReconciled }: SubmitFooterProps) {
  return (
    <footer className="sticky bottom-0 -mx-8 mt-6 flex items-center justify-between border-t bg-background/95 px-8 py-3 text-sm backdrop-blur">
      <span className="text-muted-foreground">
        {hasReconciled
          ? `${totalDiscrepancies} discrepancies · ${includedCount} to include in email`
          : 'Run reconcile to begin.'}
      </span>
      <Button disabled>Submit & mark reviewed</Button>
    </footer>
  );
}
```

- [ ] **Step 5: Update `src/app/items/[id]/page.tsx` to wire them in.** Layout becomes a two-column grid for the discrepancies + email panel, with the submit footer at the bottom. Import `renderTemplate` from `@/lib/email` and build the input via `buildEmailInput`.

Key changes near the bottom of the page (replace the existing field-findings and narrative-findings sections):

```tsx
import { buildEmailInput } from '@/lib/email/build-input';
import { renderTemplate } from '@/lib/email';
import { DiscrepancyCards } from './discrepancy-cards';
import { EmailPanel } from './email-panel';
import { SubmitFooter } from './submit-footer';

// ...inside the component, after the SOR/extracted + unparsed sections...

const templatePreview = renderTemplate(
  buildEmailInput({
    policy,
    account,
    document: doc,
    discrepancies,
    reviewer_notes: item.reviewer_notes,
  }),
);

const includedCount = discrepancies.filter((d) => d.flag_state === 'include').length;

return (
  <main className="...">
    {/* existing header + summary strip + SOR/extracted + unparsed sections */}

    <section className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
      <DiscrepancyCards itemId={item.id} discrepancies={discrepancies} />
      <EmailPanel
        itemId={item.id}
        initialMarkdown={item.email_markdown}
        discrepancies={discrepancies}
        templatePreview={templatePreview}
      />
    </section>

    <SubmitFooter
      itemId={item.id}
      totalDiscrepancies={discrepancies.length}
      includedCount={includedCount}
      hasReconciled={discrepancies.length > 0}
    />
  </main>
);
```

Add `email_markdown` and `reviewer_notes` to the `.select(...)` string at the top of the page.

- [ ] **Step 6: Build + smoke.**

Run: `pnpm build`
Expected: clean.

Run: `pnpm dev` and open any item — confirm the existing UI is intact, plus the new right-side `<EmailPanel>` shows the template preview, plus the disabled `Submit & mark reviewed` footer.

- [ ] **Step 7: Commit.**

```bash
git add src/app/items/[id]/page.tsx src/app/items/[id]/discrepancy-cards.tsx src/app/items/[id]/email-panel.tsx src/app/items/[id]/submit-footer.tsx
git commit -m "refactor(review): split detail page into card, email, footer components"
```

---

## Task 11: Discrepancy cards — include toggle + rationale + grouped sections

**Goal:** Inside `discrepancy-cards.tsx`, replace the placeholder accept/reject/escalate buttons with the Include-in-email toggle + Rationale textarea per discrepancy. Group findings into "Material" (expanded) and "Handled automatically" (collapsed) sections.

**Depends on:** Tasks 8, 10.

**Files:**
- Modify: `src/app/items/[id]/discrepancy-cards.tsx`

**Acceptance Criteria:**
- [ ] Discrepancies group into two sections: "Needs review" (`material`, `ambiguous`, `out_of_distribution`) expanded by default, and "Handled automatically" (`cosmetic`, `auto_resolved`) collapsed by default with a count in the header.
- [ ] Each card shows an `Include in email` toggle reflecting `flag_state`, calling `toggleFlag` on change.
- [ ] Each card shows a `Rationale (carrier-facing)` textarea seeded with `final_rationale`, calling `editRationale` (debounced 500ms) on edit.
- [ ] No accept/reject/escalate buttons remain.
- [ ] After any change, the page revalidates and the EmailPanel/SubmitFooter pick up updated counts.

**Verify:** `pnpm build && pnpm dev` — flip a flag, watch the queue badge update; edit a rationale, refresh, confirm persistence.

**Steps:**

- [ ] **Step 1: Add a `useTransition`-driven toggle + debounce helper inside the file.** A small inline `useDebouncedCallback` is fine.

```tsx
'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { editRationale, toggleFlag } from './actions';
import { Button } from '@/components/ui/button';
import type { Discrepancy, FieldDiscrepancy, NarrativeDiscrepancy } from '@/lib/reconcile';

const NEEDS_REVIEW_TIERS = new Set(['material', 'ambiguous', 'out_of_distribution']);

function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay: number) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay],
  );
}
```

- [ ] **Step 2: Update each card to render the toggle + textarea.** Generic card wrapper:

```tsx
function CardControls({
  itemId,
  discrepancy,
}: {
  itemId: string;
  discrepancy: Discrepancy;
}) {
  const [flag, setFlag] = useState(discrepancy.flag_state);
  const [rationale, setRationale] = useState(discrepancy.final_rationale);
  const [, startTransition] = useTransition();

  const debouncedSave = useDebouncedCallback((next: string) => {
    startTransition(() => {
      editRationale(itemId, discrepancy.id, next);
    });
  }, 500);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={flag === 'include'}
          onChange={(e) => {
            const next = e.target.checked ? 'include' : 'exclude';
            setFlag(next);
            startTransition(() => {
              toggleFlag(itemId, discrepancy.id, next);
            });
          }}
        />
        Include in email to carrier
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Rationale (carrier-facing)</span>
        <textarea
          className="min-h-[64px] rounded border bg-background p-2 text-sm font-normal"
          value={rationale}
          onChange={(e) => {
            setRationale(e.target.value);
            debouncedSave(e.target.value);
          }}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Drop the existing accept/reject/escalate `<Button>` triplet from `FieldFindingCard` and `NarrativeFindingCard`.** Replace with `<CardControls itemId={itemId} discrepancy={d} />` at the end of each card.

- [ ] **Step 4: Group findings into "Needs review" + "Handled automatically" sections.** Rewrite the top-level `DiscrepancyCards` body:

```tsx
const needsReview = discrepancies.filter((d) => NEEDS_REVIEW_TIERS.has(d.tier));
const handled = discrepancies.filter((d) => !NEEDS_REVIEW_TIERS.has(d.tier));

return (
  <div className="flex flex-col gap-6">
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        Needs review{' '}
        <span className="text-xs font-normal text-muted-foreground">
          ({needsReview.length})
        </span>
      </h2>
      {discrepancies.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Not yet compared. Click <strong>Run reconcile</strong> to populate.
        </p>
      )}
      {needsReview.map((d) =>
        d.kind === 'field' ? (
          <FieldFindingCard key={d.id} d={d} itemId={itemId} />
        ) : (
          <NarrativeFindingCard key={d.id} d={d} itemId={itemId} />
        ),
      )}
    </section>
    {handled.length > 0 && (
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Handled automatically ({handled.length})
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {handled.map((d) =>
            d.kind === 'field' ? (
              <FieldFindingCard key={d.id} d={d} itemId={itemId} />
            ) : (
              <NarrativeFindingCard key={d.id} d={d} itemId={itemId} />
            ),
          )}
        </div>
      </details>
    )}
  </div>
);
```

- [ ] **Step 5: Verify in the browser.**

Run: `pnpm dev`
Open any item, toggle a checkbox — confirm the queue row's status flips to "In review" on next navigation. Edit a rationale, wait ~1 second, refresh — confirm the new value is persisted.

- [ ] **Step 6: Commit.**

```bash
git add src/app/items/[id]/discrepancy-cards.tsx
git commit -m "feat(review): include-in-email toggle + rationale textarea per discrepancy"
```

---

## Task 12: Email panel — template preview, generate, edit

**Goal:** Implement the right-column email panel: live template preview by default, "Generate email" button that fires the LLM action, inline edit mode for the resulting markdown, and a copy-to-clipboard button.

**Depends on:** Tasks 8, 10.

**Files:**
- Modify: `src/app/items/[id]/email-panel.tsx`

**Acceptance Criteria:**
- [ ] When `email_markdown` is null, the panel shows the `templatePreview` string (passed from the server component).
- [ ] When `email_markdown` is non-null, the panel shows the saved markdown.
- [ ] A `Generate email` button (visible when no saved markdown) fires `generateEmail`, shows a loading state, and renders the result inline.
- [ ] A `Regenerate` button replaces it once a generated version exists.
- [ ] An `Edit` toggle swaps the rendered markdown for an inline `<textarea>`. The current textarea contents are passed to `submitReview` via a global ref or local state lifted to the parent — for simplicity, the panel exposes its current state to a parent-provided callback (see Step 4).
- [ ] A `Copy markdown` button copies whatever is currently visible.
- [ ] If the result's `source === 'template'`, a small badge reads "Template fallback (no API key or API error)".

**Verify:** `pnpm build && pnpm dev` — generate an email, edit it, copy it, regenerate it.

**Steps:**

- [ ] **Step 1: Replace the stub** with a stateful client component:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { generateEmail } from './actions';

export interface EmailPanelProps {
  itemId: string;
  initialMarkdown: string | null;
  templatePreview: string;
  /**
   * Called whenever the visible markdown changes (initial load, after
   * generate, after edit). The parent (SubmitFooter, via context or
   * window state) reads from here on submit.
   */
  onMarkdownChange?: (markdown: string, source: 'template' | 'llm' | 'edited') => void;
}

export function EmailPanel({
  itemId,
  initialMarkdown,
  templatePreview,
  onMarkdownChange,
}: EmailPanelProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown ?? templatePreview);
  const [source, setSource] = useState<'template' | 'llm' | 'edited'>(
    initialMarkdown ? 'llm' : 'template',
  );
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  function announce(next: string, nextSource: 'template' | 'llm' | 'edited') {
    setMarkdown(next);
    setSource(nextSource);
    onMarkdownChange?.(next, nextSource);
  }

  function onGenerate() {
    startTransition(async () => {
      const result = await generateEmail(itemId);
      announce(result.markdown, result.source);
    });
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      /* noop */
    }
  }

  return (
    <aside className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Email to carrier</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onGenerate} disabled={pending}>
            {pending
              ? 'Drafting…'
              : initialMarkdown || source !== 'template'
                ? 'Regenerate'
                : 'Generate email'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Preview' : 'Edit'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopy}>
            {copyState === 'copied' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
      {source === 'template' && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
          Template fallback — no API key or API error. Click Generate to draft via LLM.
        </span>
      )}
      {editing ? (
        <textarea
          className="min-h-[400px] w-full rounded border bg-background p-2 font-mono text-xs"
          value={markdown}
          onChange={(e) => announce(e.target.value, 'edited')}
        />
      ) : (
        <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-xs">
          {markdown}
        </pre>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Coordinate state with the submit footer.** The cleanest way for v1 is a shared client provider at the page level. Simpler: since the page is a server component, we instead lift `EmailPanel` + `SubmitFooter` into a single client wrapper. Create `src/app/items/[id]/review-shell.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { EmailPanel } from './email-panel';
import { SubmitFooter } from './submit-footer';

export interface ReviewShellProps {
  itemId: string;
  initialMarkdown: string | null;
  templatePreview: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
  children: React.ReactNode; // the discrepancy cards
}

export function ReviewShell({
  itemId,
  initialMarkdown,
  templatePreview,
  totalDiscrepancies,
  includedCount,
  hasReconciled,
  children,
}: ReviewShellProps) {
  const [currentMarkdown, setCurrentMarkdown] = useState(initialMarkdown ?? templatePreview);

  return (
    <>
      <section className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_360px]">
        {children}
        <EmailPanel
          itemId={itemId}
          initialMarkdown={initialMarkdown}
          templatePreview={templatePreview}
          onMarkdownChange={setCurrentMarkdown}
        />
      </section>
      <SubmitFooter
        itemId={itemId}
        totalDiscrepancies={totalDiscrepancies}
        includedCount={includedCount}
        hasReconciled={hasReconciled}
        currentMarkdown={currentMarkdown}
      />
    </>
  );
}
```

Update the page's JSX (Task 10's wiring) to wrap the discrepancy cards + email panel + submit footer in `<ReviewShell>`:

```tsx
import { ReviewShell } from './review-shell';

<ReviewShell
  itemId={item.id}
  initialMarkdown={item.email_markdown}
  templatePreview={templatePreview}
  totalDiscrepancies={discrepancies.length}
  includedCount={includedCount}
  hasReconciled={discrepancies.length > 0}
>
  <DiscrepancyCards itemId={item.id} discrepancies={discrepancies} />
</ReviewShell>
```

The `<DiscrepancyCards>` server-or-client distinction is fine — it lives inside a client component but its data is already serializable.

- [ ] **Step 3: Update `SubmitFooter` to accept `currentMarkdown`.** Task 13 wires the submit click; for this task just thread the prop.

```tsx
// in submit-footer.tsx — add to interface, ignore for now
currentMarkdown?: string;
```

- [ ] **Step 4: Build + smoke.**

Run: `pnpm build`

Run: `pnpm dev`, open an item with discrepancies, click `Generate email`. If `OPENAI_API_KEY` is set, expect an LLM-drafted email; otherwise the template fallback with the amber badge. Edit it inline, copy it, regenerate — confirm each transition.

- [ ] **Step 5: Commit.**

```bash
git add src/app/items/[id]/email-panel.tsx src/app/items/[id]/review-shell.tsx src/app/items/[id]/page.tsx src/app/items/[id]/submit-footer.tsx
git commit -m "feat(review): email panel with template preview, generate, edit, copy"
```

---

## Task 13: Submit footer — finalize + redirect

**Goal:** Make the submit footer functional. Clicking submits the current markdown via `submitReview`, which marks the item reviewed and redirects to `/`.

**Depends on:** Tasks 8, 10, 12.

**Files:**
- Modify: `src/app/items/[id]/submit-footer.tsx`

**Acceptance Criteria:**
- [ ] `Submit & mark reviewed` is enabled when `hasReconciled === true`.
- [ ] On click, it calls `submitReview(itemId, currentMarkdown)` inside a transition; while pending the button shows a loading label.
- [ ] After success, the user lands on `/` and the just-reviewed row appears in the reviewed group with the correct time-to-completion.

**Verify:** `pnpm build && pnpm dev` — full end-to-end: open item, generate email (optional), submit, observe queue.

**Steps:**

- [ ] **Step 1: Replace the body of `submit-footer.tsx`:**

```tsx
'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { submitReview } from './actions';

export interface SubmitFooterProps {
  itemId: string;
  totalDiscrepancies: number;
  includedCount: number;
  hasReconciled: boolean;
  currentMarkdown: string;
}

export function SubmitFooter({
  itemId,
  totalDiscrepancies,
  includedCount,
  hasReconciled,
  currentMarkdown,
}: SubmitFooterProps) {
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    startTransition(() => {
      submitReview(itemId, currentMarkdown);
    });
  }

  return (
    <footer className="sticky bottom-0 -mx-8 mt-6 flex items-center justify-between border-t bg-background/95 px-8 py-3 text-sm backdrop-blur">
      <span className="text-muted-foreground">
        {hasReconciled
          ? `${totalDiscrepancies} discrepancies · ${includedCount} to include in email`
          : 'Run reconcile to begin.'}
      </span>
      <Button onClick={onSubmit} disabled={!hasReconciled || pending}>
        {pending ? 'Submitting…' : 'Submit & mark reviewed'}
      </Button>
    </footer>
  );
}
```

- [ ] **Step 2: End-to-end smoke.**

Run: `pnpm db:reset` (clean slate).
Run: `pnpm dev`.

1. Open `/`, click into the first item.
2. Click `Run reconcile`.
3. Toggle a few `Include in email` checkboxes off, edit one rationale.
4. Click `Generate email` (optional).
5. Click `Submit & mark reviewed`.
6. Confirm redirect to `/`, the row is in the reviewed group with a time-to-completion that looks reasonable (seconds → "<1m").
7. Click `Copy email` on that reviewed row; paste into a scratchpad; confirm the markdown matches what was on screen.

- [ ] **Step 3: Commit.**

```bash
git add src/app/items/[id]/submit-footer.tsx
git commit -m "feat(review): wire submit footer to submitReview action"
```

---

## Task 14: Update CLAUDE.md to reflect current schema

**Goal:** Replace the stale "one denormalized table" section of `CLAUDE.md` with the four-table reality, and add a pointer to the new review-flow design.

**Depends on:** none. Can be done at any time, including in parallel with code work.

**Files:**
- Modify: `CLAUDE.md`

**Acceptance Criteria:**
- [ ] The "The data model" section names the four tables (`accounts`, `policies`, `documents`, `reconciliation_items`) and links to [src/lib/sor.ts](../../../src/lib/sor.ts) and [supabase/migrations/](../../../supabase/migrations/).
- [ ] The "Read this first" section links to the new spec at [docs/superpowers/specs/2026-05-19-reconciliation-review-flow-design.md](../specs/2026-05-19-reconciliation-review-flow-design.md).
- [ ] The "Stack preferences" bullet about "one denormalized table" is replaced/removed; the rest of that section is untouched.

**Verify:** Reread the file end-to-end; nothing should describe one table.

**Steps:**

- [ ] **Step 1: Open `CLAUDE.md`** and locate:
  - The "Stack preferences" bullet `Supabase from the start — one denormalized table, no auth, single mock user.`
  - The full "The data model" section.

- [ ] **Step 2: Replace the bullet** with:

```
- Supabase from the start — normalized into accounts / policies / documents / reconciliation_items. No auth, single mock user. Persistence is worth the small cost (survives HMR reloads, makes the demo land).
```

- [ ] **Step 3: Replace "The data model" section** with:

```markdown
## The data model

Four tables, normalized:

- `accounts` — the brokerage's clients.
- `policies` — placed policies; this is the system-of-record row.
- `documents` — incoming carrier/vendor docs, with the PDF blob and the
  extracted JSON envelope.
- `reconciliation_items` — queue rows joining a document to a policy,
  carrying `discrepancies jsonb` (the comparator's output), `decision_log
  jsonb` (audit trail), `email_markdown text` (the carrier email), and
  `reviewed_at / reviewed_by` (status terminal state).

The reconcile pipeline builds the SOR object by joining `policies +
accounts` via `src/lib/sor.ts` and compares against
`documents.extracted`. No code in `src/lib/reconcile/` cares about the
table shape — it sees `SystemOfRecord` and `ExtractedDocument`.
```

- [ ] **Step 4: Update "Read this first"** to add a line pointing at the spec:

```
- `docs/superpowers/specs/2026-05-19-reconciliation-review-flow-design.md` — the validated review-flow spec for the v1 build.
```

- [ ] **Step 5: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect normalized schema + review-flow spec"
```

---

## Final acceptance — full demo path

After all 14 tasks are merged, this end-to-end path should work in a clean checkout:

```
pnpm install
pnpm db:start
pnpm db:reset                       # applies migrations, seeds 5 items
pnpm dev
```

1. Visit `/` — five FIFO-sorted Pending items.
2. Click any item.
3. Click `Run reconcile` — discrepancies populate, grouped into Needs review (expanded) and Handled automatically (collapsed). Each card has Include + Rationale.
4. Toggle a couple of flags off; edit one rationale. The status badge flips to In review on next page nav.
5. Click `Generate email` — LLM-drafted markdown appears (or template fallback with an amber badge if `OPENAI_API_KEY` is unset). Edit inline if desired.
6. Click `Submit & mark reviewed` — redirect to `/`. The row now shows `Reviewed · <time>` muted, with a `Copy email` button.
7. Click `Copy email` — clipboard now has the full markdown.

The `decision_log` jsonb on the reviewed row contains every flag flip, rationale edit, generate, and submit event for audit. That's the verbal feedback-loop talking point during the demo.

---

## Self-review notes

**Spec coverage check.** Every concrete requirement in the design doc has a task:

- Queue FIFO + status + time-to-completion → Task 9.
- Detail header strip (existing) → untouched, still works.
- SOR/extracted side-by-side (existing) → untouched.
- Unparsed sections block (existing) → untouched.
- Discrepancy cards with Include + Rationale → Task 11.
- Two sections (material vs. handled automatically) → Task 11.
- Right-column email panel with template + LLM + edit + copy → Task 12.
- Submit footer → Tasks 10 (stub) + 13 (wired).
- `email_markdown`, `reviewed_at`, `reviewed_by` columns → Task 1.
- Extended `status` constraint → Task 1.
- `flag_state`, `suggested_rationale`, `final_rationale` on each discrepancy → Tasks 2, 3, 4, 5.
- Extended `DecisionLogEntry.action` union including `generate_email` → Task 2.
- Server actions (`toggleFlag`, `editRationale`, `generateEmail`, `submitReview`) → Task 8.
- LLM seam carrier-facing `suggested_rationale` → Task 4.
- New `src/lib/email/` module → Tasks 6, 7, 8 (build-input helper).
- LLM-drafted email with template fallback → Task 7.
- CLAUDE.md drift → Task 14.

**Placeholder scan.** No TBDs, no "implement later", no "add appropriate error handling" without showing what. Each code step has actual code.

**Type consistency.** Names match across tasks: `flag_state`, `suggested_rationale`, `final_rationale`, `EmailDraftInput`, `EmailDraftResult`, `EmailItem`, `draftEmail`, `renderTemplate`, `buildEmailInput`, `generateEmail`, `submitReview`, `toggleFlag`, `editRationale`. The post-process defaulter lives in exactly one place (`reconcile/index.ts`, Task 5) so neither `rules.ts` nor `llm.ts` needs to know the per-tier default policy.

**One known caveat for executors.** Task 2's commit will leave `pnpm check` failing inside `rules.ts` and `llm.ts` until Tasks 3 and 4 land. This is intentional — those three tasks share a transitive type contract and must be merged as a group. Coordinate accordingly when running in parallel: Task 2 → (Tasks 3, 4 in parallel) → Task 5, on the same branch or with rebase-aware coordination.

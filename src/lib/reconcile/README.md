# `src/lib/reconcile/`

This is **where the LLM lives**. Any comparison between a system-of-record
value and an extracted document value goes through `reconcile()`.

The pipeline is shaped for **semi-structured extraction** — the format a
real document extractor actually emits (per-field envelopes with
`raw_text` + `confidence`, plus free-text `unparsed_sections` the
extractor couldn't classify). In that world the LLM is the **primary
comparator**; the rules pass is only a pre-filter that hides
trivially-equivalent fields.

## Layout

| File         | Responsibility                                                          |
| ------------ | ----------------------------------------------------------------------- |
| `types.ts`   | 5-tier taxonomy, `ExtractionField` envelope, `Discrepancy` union        |
| `rules.ts`   | Pre-filter: cosmetic / auto_resolved only. Everything else → LLM        |
| `prompts.ts` | System + user prompt builders. Asks for field AND narrative findings    |
| `llm.ts`     | **The LLM seam.** `generateText` + `Output.object` against OpenAI       |
| `index.ts`   | `reconcile(sor, ext)` — the public surface                              |

## Flow

```
reconcile(sor, ext)
  ├── runRules()                 ← deterministic pre-filter
  │     └── emits trivial cosmetic / auto_resolved (audit-log only)
  │     └── returns: residueFields[]
  └── compareWithLlm()           ← primary comparator
        ├── sees: residue fields (with raw_text + confidence)
        ├── sees: ALL unparsed_sections (free-text the extractor punted on)
        └── emits:
             - field findings (one per residue field, including 'cosmetic'
               if the LLM judges them equivalent)
             - narrative findings (material changes hidden in unparsed_sections —
               added exclusions, deductible-application changes, etc.)
```

The LLM call uses Vercel `ai`'s `generateText` with `Output.object({ schema })`
and a zod discriminated-union schema, so the output is validated
structurally. No free-form JSON parsing.

Falls back to a "needs review" stub per residue field when
`OPENAI_API_KEY` is empty or unset, so the UI keeps working offline.
Narrative findings cannot be faked — they only appear when the LLM is
available.

## Why rules don't do the comparison

In a clean key-value world, rules can adjudicate "limit cut from \$2M to
\$1M" deterministically. In a semi-structured world they cannot:

- A 17% premium jump may be benign renewal growth or a coverage scope
  change. Only narrative tells you which.
- A new workers'-comp class code can be operational expansion or a hidden
  scope shift. Only narrative tells you which.
- An exclusion silently added in a cover letter never shows up as a
  structured field at all.

So rules step back to "tell me which fields I don't need to bother the
LLM about." The LLM does the judgment work and reads the free text.

## Wiring it in

- `POST /api/reconcile` — accepts `{ item_id }`, runs the pipeline, writes
  `discrepancies` + `severity` back to `reconciliation_items`.
- Add new prompts to `prompts.ts`. Tune the rules pre-filter in `rules.ts`.
  Keep the public surface (`reconcile()`) stable.

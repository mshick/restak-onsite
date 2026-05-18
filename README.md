# restak-onsite

Prototype scaffold for the Restak virtual onsite. A reconciliation-queue UI
backed by a single denormalized Supabase table, with an isolated LLM seam in
`src/lib/reconcile/` for comparing system-of-record fields against extracted
document fields.

See [CLAUDE.md](CLAUDE.md) for the full framing, scope, and repo layout.

## Run

```bash
pnpm install
cp .env.example .env.local        # paste keys printed by `pnpm db:start`
pnpm db:start                     # local Supabase (Docker)
pnpm db:reset                     # apply migration + seed two sample items
pnpm dev                          # http://localhost:3000
```

Set `OPENAI_API_KEY` to enable LLM-based comparison; without it the
LLM step falls back to a "needs review" stub so the UI keeps working.

## The LLM seam

`src/lib/reconcile/` — see [its README](src/lib/reconcile/README.md). All
LLM calls go through `reconcile(sor, ext)`. Trigger a run from the detail
view, or `POST /api/reconcile` with `{ "item_id": "..." }`.

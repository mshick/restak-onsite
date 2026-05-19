# restak-onsite

Prototype scaffold for the Restak virtual onsite.

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

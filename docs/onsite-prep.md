# Restak Onsite Prep

A working brief for the virtual onsite. The goal of this doc is to walk in with strong instincts about the problem space, a discrepancy taxonomy ready to defend, and a v1 sketch I can build inside 75 minutes.

---

## The prompt (verbatim)

> **Restak Virtual Onsite**
>
> **What to Expect.** You'll spend 3 hours with our engineering team over video. Think of a working session, not an interview.
>
> **Format.** We'll hand you a problem similar to what you'd actually work on here. Your job is to figure out what needs to be built and start building it. Product thinking matters just as much as code. We'll be in the room the whole time. Ask us questions, push back on us, treat us like teammates. That's kind of the whole point: we're trying to figure out what it's like to work with you.
>
> **Problem Space.** Insurance brokerages are constantly processing documents: renewals, endorsements, certificates, audits. Each one needs to be checked against what's already in their system. Today that looks like someone comparing a PDF to a spreadsheet, line by line, flagging anything that looks off. Lots of manual work, lots of room for error. You'll be building a tool that helps with part of this workflow. We'll give you structured data (the system of record) and semi-structured data (extracted from documents). Worth thinking about ahead of time: what makes a discrepancy obvious vs. subtle? When can the system handle it on its own, and when does a human need to step in? What does that person actually need on their screen to make a call? You don't need any insurance background. We'll fill you in during the session.
>
> **Schedule.** Product discovery and problem framing (~45 min). Break. Build session (~75 min). Break. Architecture and working style (~45 min). Q&A (~10 min).
>
> **How to Prepare.** Bring your normal dev setup, including whatever AI tools you use day-to-day. No LeetCode. No trick questions.
>
> **What We're Looking For.** You can look at a messy problem and figure out where to start. You think about how the system improves itself over time. You get who's going to use this and what their day looks like. You keep things simple without being naive. You make the people around you better.

---

## What they're really testing

The 45-minute framing block before any code is the tell. They want to watch me decompose a fuzzy domain into a v1, then build the smallest slice that proves the framing. The build is evidence for the framing, not the other way around.

The "no insurance background needed" line is misleading — not because I need to know insurance, but because they want someone who, handed an unfamiliar domain, asks the right questions in the first ten minutes. Walking in with the vocabulary helps.

The three explicit signals to hit hard:

- **Feedback loops** — they said "learning from user corrections" out loud. Whatever I build needs a visible story for how human decisions improve the system.
- **The user's day** — they said "not just the happy path." Be ready to describe the reviewer: volume, batching, deadlines, escalation paths.
- **Simple but not naive** — clean v1 + a clear-eyed list of what would break at scale, not all bolted into v1.

---

## Likely build scenarios

Ranked by what I'd bet on, given they listed renewals / endorsements / certificates / audits explicitly.

1. **Certificate of Insurance (COI) verification.** Most likely. A COI is a one-page doc a vendor sends to prove they have coverage; the brokerage checks it against the actual policy. Tight scope, varied field types in a small space: exact-match (policy number), fuzzy-match (entity names), set-match (additional insureds), numeric-with-tolerance (limits), date-match (expiration). Good test bed for the discrepancy taxonomy.

2. **Renewal comparison.** Compare a renewal proposal (extracted from PDF) against the expiring policy in the system. Surface what changed: premium delta, deductible change, new exclusions, dropped schedule items. Interesting wrinkle: not all changes are discrepancies — some are expected (premium adjustment), some are red flags (silently dropped coverage). Forces a distinction between "expected delta" and "anomaly."

3. **Endorsement reconciliation.** Endorsements are mid-term amendments. Doc says "add Vehicle X effective Jan 15." System verifies the endorsement matches the original change request (if any), then applies it. More workflow-flavored than diff-flavored.

4. **Audit reconciliation.** Workers' comp audit comes back with adjusted payroll-by-class-code; compare to brokerage records, flag carrier mismatches. Most numeric-heavy, least UI-heavy. Probably not their pick for a 75-min build.

I'm preparing hardest for **#1 and #2**.

---

## Discrepancy taxonomy (have this on the tip of my tongue)

Whatever the surface problem, a discrepancy is not a binary. Five tiers:

1. **Cosmetic** — whitespace, casing, "Inc" vs "Inc.", obvious abbreviations. Auto-resolve. Don't even surface.
2. **Reconcilable with rules** — date format mismatch, known carrier-name abbreviations, sub-tolerance numeric drift. Auto-resolve with logged reason. Surface in audit log, not in reviewer queue.
3. **Material but unambiguous** — limit dropped from $2M to $1M, additional insured removed. Surface to reviewer, pre-categorized by severity.
4. **Ambiguous** — extracted field is low-confidence, or matches multiple entities in the system. Surface with the original PDF region visible; ask the human to disambiguate.
5. **Out of distribution** — field type never seen, or structural mismatch. Escalate. Do not pretend to handle.

The feedback loop story falls out of this naturally: every human resolution in tiers 3 and 4 is a labeled example. Pattern across many reviewers + same correction → a candidate auto-rule for tier 2. Track per-field error rates to know which extraction fields to retrain.

---

## What the system actually outputs

Three composable output types under every variant:

1. **A decision** — accept / reject / partial-accept / escalate. The cheap part.
2. **A state change** to the system of record — usually field-level, sometimes a new record.
3. **An outbound artifact** — email to client, dispute letter to carrier, signed-off summary for the file, request for a corrected doc.

Plus always: **an audit trail entry** capturing who decided what, when, with what evidence visible at the time. This is the regulatory backbone — non-negotiable in insurance.

Mapping to the likely scenarios:

- **COI** → binary decision + status update on vendor record + optional outbound "please send corrected cert"
- **Renewal** → line-item veto over a structured diff + write-back of accepted changes + generated "what changed" summary for the client
- **Endorsement** → apply-or-reject + state change + audit trail entry
- **Audit** → accept-or-dispute + reconciled record + outbound dispute letter

If they ask me to build a COI checker and I design a line-item veto UI, I've over-engineered. If they ask me to build a renewal tool and I design a single approve/reject, I've under-engineered. **Ask early: "When the reviewer is done with one of these, what gets written where, and what gets sent to whom?"**

---

## v1 build, in 75 minutes

What needs to be on screen by the end:

- A queue view with 5–10 fake items, varied severity, sorted by deadline pressure
- A detail view with side-by-side fields (system of record vs. extracted), color-coded by the taxonomy tier
- Per-discrepancy actions: approve / reject / edit / escalate, with a reason field
- *Some* visible feedback-loop hook — even just "mark as auto-resolvable in the future" that adds a visible rule to a sidebar list. Doesn't need to work end-to-end; needs to communicate the intent.

What I'm explicitly skipping and will say so:

- Auth (mock a single user)
- Document extraction (input is already extracted JSON; this is given)
- Multi-user concurrency, optimistic locking, etc. (mentioned as v2)
- Real migrations / schema evolution (one denormalized table, picked once, lived with)

---

## Stack

Using my personal **Next.js + Supabase + Tailwind + ShadCN starter**. The reasoning:

- I don't know exactly what they'll throw at me. Next.js gives me route handlers, server actions, and file-based routing if the problem turns server-shaped. If it stays client-only, the overhead is negligible.
- The starter is hot — first useful UI in minutes, not the first half hour. The build budget is 75 minutes; setup time is the enemy.
- Tailwind + ShadCN means I can ship something that *looks* like a product. The reviewer queue lives or dies on whether severity color-coding, the diff layout, and action affordances read clearly at a glance. Unstyled hand-rolled UI does not communicate product thinking; it communicates "ran out of time." People are influenced by what they see, including interviewers.
- Supabase is wired in the starter; use it. The complexity gap vs. in-memory state is small, and persistence pays for itself twice: I won't have to reseed fixtures every time HMR triggers a full reload, and during the demo "approve this item → refresh → still approved" tells the audit-trail story more cleanly than a hand-wave. One denormalized table, no auth, single mock user. The one trap is schema churn early in the build — if I change the queue item shape at minute 40, stale persisted records become noise. Mitigation: commit to a data shape by ~minute 20–25 (right around when framing ends), then iterate UI and behavior only. Fallback if Supabase has any setup friction in the moment: `idb-keyval` — two function calls.
- TanStack Query for queue/detail data flow against the Supabase wrapper — gives realistic loading/refetch UX and shows I think about server state correctly.

What I'm *not* spending build time on:

- ShadCN component customization. Use defaults; the design lives in information hierarchy, not in variant tuning.
- Supabase schema *design*. One table, denormalized, don't over-think it. Migrations are not happening in a 75-minute build.
- Auth. Single mock user.

---

## Questions for the 45-min framing session

Open with the user, narrow to the data, end with the boundaries:

1. **Who's the user** — broker, account manager, dedicated ops? What's their volume per day? Are they specialists by document type or generalists?
2. **What does "done" look like** for one item — a decision logged, a record updated, an email sent, all three?
3. **Cost asymmetry** — what's the cost of a missed discrepancy vs. annoying the reviewer with too many flags? These are different products.
4. **How does the system of record get updated** — does this tool write back, or just produce a recommendation a human applies elsewhere?
5. **Where does the extracted data come from**, and what's the current extraction accuracy? *(The sneaky-important one — a big chunk of "discrepancies" in real deployments are actually extraction errors, and the reviewer's first job is correcting the extraction before judging the diff. Surfacing this distinction in framing will stand out.)*
6. **Time pressure per document type** — is anything overdue, due soon, routine? Drives queue prioritization.
7. **Multi-reviewer dynamics** — do two reviewers ever look at the same item? Is there a senior-reviewer escalation tier?
8. **Audit trail requirements** — what's the regulatory expectation for retention and reproducibility?

Don't ask all eight; pick the ones that haven't been answered by minute 20 and drop the rest.

---

## Things to say out loud during the build

The "think out loud, pull others into decisions" line in the rubric is explicit. Some moments to verbalize:

- When I pick the scenario lens ("I'm going to build this as if it's a COI checker; if it should be a renewal tool, the queue stays but the detail view changes — flag me if I'm pointed wrong")
- When I commit to the taxonomy ("I'm going to color-code by these five tiers; want to challenge any of them before I bake them in?")
- When I skip something ("Not building extraction; assuming JSON input. Not building auth; single mock user. Tell me if either of those is the wrong call.")
- When I make a stack choice that has alternatives ("Going with in-memory store over IndexedDB; if you want persistence across reloads we can swap, but it doesn't change the UI.")

---

## Risks to manage

- **Talking too long in framing.** 45 min is the cap, not the target. If I've got the scenario pinned by minute 25, offer to start sketching.
- **Over-investing in the queue.** The detail view is where the product thinking shows. The queue is a list with sort/filter.
- **Tinkering with chrome.** The starter is meant to disappear into the background. If I'm 20 minutes in and still fiddling with layout primitives or ShadCN variants, I'm losing. Ship ugly-but-correct structure first, polish in the last 10 minutes.
- **Forgetting the feedback loop.** Easy to skip under time pressure. Even a stubbed "mark as auto-resolvable" affordance is enough.
- **Demoing without narrating.** Walk them through the screen at the end as if onboarding a reviewer on day one. That's the user-empathy beat closing the loop.

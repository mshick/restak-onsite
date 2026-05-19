# Key terms

A reference for the vocabulary used in this project. Three sections:
domain (insurance), product (this app's concepts), and the workflow
roles that show up when talking about who does what.

---

## Insurance domain

**Brokerage.** Independent intermediary that places insurance for a
client (the "insured") with one or more carriers. Makes money on
commissions. Holds the operational record of every policy it places —
the "system of record" — and is the party responsible for catching
discrepancies between what was placed and what shows up in carrier
documents.

**Carrier.** The actual insurance company underwriting the policy. The
party the brokerage is reconciling *against* — every renewal proposal,
endorsement, and certificate originates with a carrier.

**Insured.** The client being insured. A business, usually, in
commercial lines (which is the universe this app sits in).

**System of record (SOR).** The brokerage's authoritative database row
for a policy. Structured, typed, internally consistent. The "left side"
of every comparison this app does.

**Certificate of Insurance (COI).** Short, usually one-page document a
vendor sends to a counterparty to prove they have coverage. ACORD 25
is the dominant form. Tight scope: insured name, policy number, term
dates, limits, additional insureds, sometimes endorsements referenced
in narrative. Most-common case for this app's v1.

**Renewal proposal.** Multi-page document from a carrier offering
terms for the *next* policy period. Always has a structured limits/
premium table; almost always has free-text sections (cover letter,
endorsement schedule) where coverage changes hide.

**Endorsement.** An amendment to a policy. Can be added at issuance
("Endt #3 attaches at inception") or mid-term ("add vehicle X effective
Jan 15"). Each endorsement is identified by a form number — `WC 00 04
14` style for standard NCCI forms, carrier-proprietary codes like
`EXC-1142` for non-standard ones. Often abbreviated **Endt**.

**Audit (workers' comp).** Year-end reconciliation where the carrier
recalculates premium based on actual payroll vs. estimated payroll,
broken down by class code. The brokerage checks the audit against its
records and disputes anything wrong.

**Class codes.** Workers'-comp employee classifications. Numeric
(8810 = clerical office, 5403 = carpentry NOC). Most states use NCCI
codes; California, New York, New Jersey, Pennsylvania, and a few others
run their own bureaus. Each class has a rate per $100 of payroll;
premium = payroll × rate ÷ 100. Adding a high-rate class (e.g. 5403)
to a low-rate operation is a meaningful scope change, not bookkeeping.

**Additional insured.** A party other than the policyholder who gets
the protection of the policy for a specific risk. A landlord listed on
a tenant's general-liability policy, for example. COIs frequently
attest to additional-insured status; the actual mechanism is an
endorsement (CG 20 10 04 13 is the most common general-liability form).

**Aggregate limit.** The maximum the carrier will pay across all claims
during the policy period. Distinct from the **per-occurrence limit**,
which is the cap on a single claim. A general-liability policy at
"$1M / $2M" means $1M per occurrence, $2M aggregate.

**Deductible.** Amount the insured pays before the carrier pays.
Application matters: **per-occurrence** means a deductible per claim;
**aggregate** means a single deductible that erodes across claims.
Quietly switching between the two is a real renewal trick.

**Exclusion.** A coverage *carve-out* — something the policy does
*not* cover. Added via endorsement. "Assault & Battery exclusion" on
a general-liability policy means the carrier won't defend or pay for
A&B claims. Removing existing coverage by adding an exclusion is one
of the highest-impact things a carrier can do at renewal.

**Subrogation.** Carrier's right to pursue a third party after paying
a claim ("you damaged our insured's property; we paid them, now we're
coming after you"). **Waiver of subrogation** means the carrier gives
up that right against named parties — common when an insured's client
demands it as a contract condition.

**Experience rating modification (e-mod).** Multiplier on workers'-
comp premium based on the insured's own claim history vs. the class
average. 1.00 = exactly average. 1.07 = 7% worse than average,
premium gets bumped. 0.93 = 7% better, premium gets a credit. Tracked
by the rating bureau, not the carrier.

---

## Product / app concepts

**Reconciliation.** The act of comparing what a document says against
what the system of record says, classifying every difference, and
deciding what to do about each one. This app does step 1 (compare +
classify) automatically and surfaces step 2 (decide) to a human.

**Discrepancy.** A single difference between SOR and extracted
document, with a tier assigned. JSON-serialized; lives in the
`discrepancies` jsonb column on `reconciliation_items`.

**Discrepancy taxonomy (five tiers).** Ordered from cheapest to most
expensive to handle:

| Tier | Meaning |
|---|---|
| `cosmetic` | Same meaning, different surface ("Inc" vs "Inc."). Audit log only; not surfaced. |
| `auto_resolved` | Reconcilable by a documented rule (date-format equivalence, sub-tolerance numeric drift). Logged; not blocking. |
| `material` | Unambiguous, meaningful change a reviewer should see (limit cut, AI removed). The main thing the queue exists for. |
| `ambiguous` | Low-confidence extraction or multi-match. Needs a human to disambiguate. |
| `out_of_distribution` | Structurally unexpected. Escalate; do not pretend to handle. |

**Severity.** Item-level summary of the worst tier among its
discrepancies. Drives queue color-coding and sort.

**Field finding.** A discrepancy attached to a specific structured
field on both sides of the comparison (e.g. `expiration_date`,
`annual_premium`). The pipeline emits one per residue field.

**Narrative finding.** A discrepancy the LLM spotted in an
`unparsed_section` — free text the extractor couldn't promote to a
structured field. Always `source: 'llm'`. Carries a verbatim
`excerpt` so the reviewer can verify in seconds. The load-bearing
half of the comparator: a quietly-added exclusion in a cover letter
only shows up here.

**Extraction envelope.** The shape an extractor (Textract, Reducto, an
in-house Claude pass) returns per field:

```
{ value, raw_text, confidence, page, bbox? }
```

Stored under `extracted.fields[name]`. The pipeline reads `value` for
comparison and `raw_text` + `confidence` for context.

**Unparsed section.** Free-text region the extractor couldn't fit
into a structured field. Cover letters, endorsement schedules,
"Description of Operations" blocks. Lives at
`extracted.unparsed_sections[]`. The rules pass cannot read these; the
LLM pass always scans them.

**Confidence score.** 0–1 number on each extracted field, reflecting
how sure the extractor is. Below `CONFIDENCE_FLOOR` (currently 0.7),
rules always defer to the LLM regardless of value match.

**Residue field.** A field the rules pass couldn't trivially classify
(everything except exact-match and rule-resolved cosmetic/auto). The
LLM gets only these, plus all unparsed sections.

**Rules pass.** Deterministic pre-filter ([rules.ts](../src/lib/reconcile/rules.ts)).
Emits only `cosmetic` and `auto_resolved`. Anything else routes to the
LLM.

**LLM pass.** Primary comparator ([llm.ts](../src/lib/reconcile/llm.ts)).
Reads residue fields + all unparsed sections; emits field findings
(one per residue field) and zero-or-more narrative findings. Currently
gpt-5.4-mini via the Vercel AI SDK with `Output.object` structured
outputs.

**Decision log.** Append-only audit trail per item
(`reconciliation_items.decision_log` jsonb). Captures who did what to
which discrepancy, when, with what evidence visible. The regulatory
backbone — and the source data for any future auto-rule curation.

**Reviewer actions.** Per-discrepancy: **accept** (system gets updated
from document), **reject** (document is wrong, send it back), **edit**
(correct a value first, then accept), **escalate** (kick to a senior
queue — neither call is mine to make). Each appends a `DecisionLogEntry`.

**Auto-rule.** A pattern promoted from "needs human judgment" to "the
rules pass handles this automatically." V1 has three hardcoded rules
(string normalization, numeric tolerance, date-format equivalence).
V2+ would derive new ones from `decision_log` patterns and surface
them as **rule candidates** on a curator screen for approval.

**Rule candidate.** A proposed auto-rule that hasn't been approved
yet. Lives downstream of the operational queue, on a different surface,
at a slower cadence (weekly review, not per-decision).

**Reconciliation queue.** The home page. List of items awaiting
reviewer attention, sorted by deadline pressure, color-coded by
severity.

---

## Workflow roles

**Account manager (AM).** Front-line reviewer. Works the queue
day-to-day, makes accept/reject calls on routine items, escalates
anything they can't or shouldn't decide alone.

**Senior account manager / Account executive (AE).** Handles
escalations. More experience, more authority, often the bridge
between the operational queue and the producer.

**Producer.** The salesperson who owns the client relationship. Gets
pulled in when something requires a client conversation — coverage
cut at renewal, dispute with carrier, new exposure to underwrite.

**Underwriter.** Carrier-side role; the person who decides what
coverage to offer at what price. The brokerage *talks to* underwriters
but doesn't employ them. Mentioned here because carrier behavior
(silent exclusions, premium jumps) is upstream of the brokerage's
review work.

**Risk manager / specialist.** In-house at larger brokerages.
Handles unusual coverage interpretations, complex programs, anything
that needs domain expertise beyond standard placement.

**Rules curator / ops lead.** The person (or role) who reviews
proposed auto-rules and decides which to promote. Distinct from
working the queue itself. At a small brokerage, often the same person
as the senior AM, wearing a different hat. At a large one, a dedicated
role.

---

## Convenient shorthand used in this codebase

**Load-bearing.** Borrowed from construction. Used to mark the parts
of the system that justify its existence — strip them out and the
rest loses its reason to be. The narrative-finding pass is
load-bearing because everything else (queue, side-by-side, field-
level diff) could plausibly be built without an LLM; the narrative
scan is the part that can't.

**The seam.** Where the LLM call lives, isolated from the rest of the
pipeline so providers/models/prompts can be swapped without
callers moving. That's [src/lib/reconcile/](../src/lib/reconcile/),
and `compareWithLlm()` specifically.

**Pre-filter vs. primary comparator.** What the rules pass and the
LLM pass are, respectively. The rules pass does *not* try to classify
material/ambiguous findings — that takes judgment, and judgment is the
LLM's job. Rules just hide the trivially-equivalent fields so the LLM
isn't paying attention to noise.

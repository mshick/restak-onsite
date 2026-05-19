# What this app is, from the user's perspective

A reconciliation queue for insurance-brokerage reviewers. They get
documents (certificates, renewals, endorsements, audits) all day; the
app pre-reads each one against the brokerage's system of record, tiers
the differences, and lets the reviewer spend their time on decisions
instead of line-by-line eyeballing.

See [key-terms.md](key-terms.md) for the vocabulary used below.
See [onsite-prep.md](onsite-prep.md) for the working brief.

---

## The user

An insurance brokerage account manager or operations clerk. Their day
involves a steady drip of documents — certificates of insurance from
vendors, renewal proposals from carriers, mid-term endorsements,
payroll audits — and each one has to be checked against what the
brokerage already has on file in their system of record. The work is
slow, fiddly, and high-stakes: a missed coverage cut or a silently
dropped additional insured can mean an uninsured loss the brokerage
is on the hook for.

Today they're doing it by hand. PDF on one monitor, spreadsheet on
the other, line by line.

---

## What this app does for them

Replaces that side-by-side eyeball compare with a queue that has
already done the first reading. When a document arrives, the system
runs it through a comparison pipeline and pre-classifies every
difference into one of five tiers — cosmetic, auto-resolved,
ambiguous, material, or out-of-distribution. The reviewer only needs
to see the things that actually matter, in the order they matter.

---

## The flow

### 1. The queue

The reviewer lands on a list of documents waiting on them. Each row
shows what the document is (COI, renewal, endorsement, audit), how
many differences were found, the highest-severity tier, and a deadline.
The list is sorted by what's most urgent. They pick one.

### 2. The detail view

Side-by-side: the system-of-record row on the left, what was pulled
out of the document on the right. The extracted side shows confidence
scores and a click-through to the raw text from the page — so when
something looks wrong, they can verify against the document in a
second, not a minute.

Below that, the free-text sections of the document the extractor
couldn't fit into structured fields — cover letters, endorsement
schedules, descriptions of operations. These are normally where
coverage changes hide.

Below that, the findings:

- **Field findings** — one per disputed field. Tiered. Cosmetic ones
  are noted for the audit trail but don't demand attention. Material
  ones are highlighted.
- **Narrative findings** — issues the LLM spotted in the free-text
  sections, with verbatim quotes. This is the load-bearing part: a
  renewal cover letter that says "exclusion EXC-1142 (Assault &
  Battery) has been added" is the kind of thing a pure-diff tool would
  miss entirely, and it's exactly what the reviewer needs to see and
  decide on.

### 3. The decision

For each finding, the reviewer can:

- **Accept** — the document is right; update the system.
- **Reject** — the document is wrong; send it back.
- **Edit** — correct the value first, then accept.
- **Escalate** — kick it to a senior queue; neither call is mine to
  make.

Every decision becomes a row in the audit trail.

---

## The intended outcome

Three things, in order of importance:

1. **Reviewers stop being readers.** The model reads the long-form
   sections. The reviewer judges. Hours of reading per item becomes a
   minute or two of decisions.
2. **Nothing material gets missed.** Especially the narrative-section
   catches — exclusions added, deductibles re-applied, scope quietly
   changed. These are the bugs that bite a brokerage.
3. **The system gets smarter over time.** Every accept/reject is
   labeled data. Patterns across reviewers — "we keep accepting this
   kind of cosmetic difference" — become candidate auto-resolve rules,
   which shrink the queue further. Every escalation tells you which
   fields the extractor is bad at, which tells you where to invest in
   better extraction. The reviewer's day-to-day work is also the
   training signal.

The end state isn't "AI does the work." It's "a human does the
deciding, and only the deciding." The audit trail keeps it defensible
to regulators; the human-in-the-loop keeps it honest.

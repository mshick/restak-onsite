-- Seed rows for the queue.
--
-- The two payloads differ in shape on purpose:
--
--   system_of_record  → structured, what you'd read out of a Postgres row.
--                       Flat. Typed. Authoritative.
--
--   extracted         → semi-structured, what a doc extractor (OCR + LLM,
--                       or a vendor like Textract/Reducto) actually returns:
--                       per-field envelope with `value`, `raw_text`,
--                       `confidence`, `page`, plus an `unparsed_sections`
--                       array for the free-text the extractor couldn't
--                       classify (cover-letter narrative, endorsement
--                       descriptions, footnotes).
--
-- Why the asymmetry matters: the deterministic rules pass can only see the
-- typed `value` slots. The `raw_text`, low `confidence`, and especially the
-- `unparsed_sections` are where the LLM earns its keep — that's the residue
-- a human (or claude-sonnet-4-6) has to read.

insert into public.reconciliation_items
  (reference, doc_type, status, severity, due_at, system_of_record, extracted)
values

-- ──────────────────────────────────────────────────────────────────────────
-- 1) Certificate of Insurance, ACME Logistics
--
-- Structured row from the brokerage system vs. extraction of a one-page
-- ACORD 25 certificate. Notice:
--   - `insured_name` extracted as "ACME LOGISTICS INC" with no punctuation
--   - `expiration_date` extracted with a clearly wrong year (12/31/2026 vs
--     2027 on file) — high confidence; this is a material change, not noise
--   - `each_occurrence` cut in half — high confidence; material
--   - `additional_insureds` extraction missed one of the two on file
--     (low confidence on the section)
--   - `unparsed_sections` contains the "Description of Operations" narrative
--     where additional-insured endorsements are sometimes actually listed —
--     the rules engine cannot see this; the LLM can.
-- ──────────────────────────────────────────────────────────────────────────
(
  'ACME-COI-2026-04',
  'coi',
  'open',
  null,
  now() + interval '2 days',
  jsonb_build_object(
    'insured_name',     'Acme Logistics, Inc.',
    'policy_number',    'GL-2026-009881',
    'effective_date',   '2026-01-01',
    'expiration_date',  '2027-01-01',
    'general_liability_each_occurrence', 2000000,
    'general_liability_aggregate',       4000000,
    'additional_insureds', jsonb_build_array('Northwind Holdings LLC', 'Contoso Properties')
  ),
  $json$
  {
    "source": {
      "filename": "acme_coi_20260415.pdf",
      "pages": 1,
      "extracted_at": "2026-04-15T14:22:11Z",
      "extractor": "claim-extract-v3"
    },
    "fields": {
      "insured_name": {
        "value": "ACME LOGISTICS INC",
        "raw_text": "INSURED\n  ACME LOGISTICS INC\n  1421 INDUSTRIAL PKWY, COLUMBUS OH 43215",
        "confidence": 0.94,
        "page": 1,
        "bbox": [120, 240, 380, 295]
      },
      "policy_number": {
        "value": "GL-2026-009881",
        "raw_text": "POLICY NUMBER  GL-2026-009881",
        "confidence": 0.98,
        "page": 1
      },
      "effective_date": {
        "value": "01/01/2026",
        "raw_text": "POLICY EFF (MM/DD/YYYY)\n01/01/2026",
        "confidence": 0.91,
        "page": 1
      },
      "expiration_date": {
        "value": "12/31/2026",
        "raw_text": "POLICY EXP (MM/DD/YYYY)\n12/31/2026",
        "confidence": 0.88,
        "page": 1
      },
      "general_liability_each_occurrence": {
        "value": 1000000,
        "raw_text": "EACH OCCURRENCE  $ 1,000,000",
        "confidence": 0.97,
        "page": 1
      },
      "general_liability_aggregate": {
        "value": 4000000,
        "raw_text": "GENERAL AGGREGATE LIMIT APPLIES PER:\n[X] POLICY  [ ] PROJECT  [ ] LOC\n$ 4,000,000",
        "confidence": 0.85,
        "page": 1
      },
      "additional_insureds": {
        "value": ["Northwind Holdings, LLC"],
        "raw_text": "ADDITIONAL INSURED\n  Northwind Holdings, LLC",
        "confidence": 0.61,
        "page": 1
      }
    },
    "unparsed_sections": [
      {
        "label": "DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES",
        "page": 1,
        "text": "Certificate holder is included as additional insured with respect to general liability per attached endorsement form CG 20 10 04 13. Waiver of subrogation applies per CG 24 04 05 09. See attached schedule for additional named insureds."
      }
    ],
    "warnings": [
      "additional_insureds: confidence 0.61 — second insured may be in DESCRIPTION OF OPERATIONS section"
    ]
  }
  $json$::jsonb
),

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Renewal proposal, Globex
--
-- Renewals are where extraction gets messy on purpose: the structured
-- fields come out cleanly, but the carrier's substantive changes hide in
-- the cover letter and endorsement schedule narrative. Notice:
--   - `policy_number` extracted with the new term's year — not a discrepancy
--     per se, but the human needs to confirm "is this the renewal of the
--     same policy"
--   - `annual_premium` jumped 17% — likely expected, but worth surfacing
--   - `class_codes` shows a new code (5403) added — could be benign growth
--     or could be a coverage scope change
--   - The cover-letter narrative contains a quietly added exclusion
--     ("assault & battery") and a deductible-application change that the
--     extractor did not promote to a structured field. Pure-rules
--     comparison will MISS BOTH. The LLM has to read the narrative.
-- ──────────────────────────────────────────────────────────────────────────
(
  'GLOBEX-RENEWAL-Q2',
  'renewal',
  'open',
  null,
  now() + interval '5 days',
  jsonb_build_object(
    'insured_name',  'Globex Corporation',
    'policy_number', 'WC-2025-44210',
    'annual_premium', 18400,
    'deductible',     5000,
    'class_codes',    jsonb_build_array('8810', '8742')
  ),
  $json$
  {
    "source": {
      "filename": "globex_renewal_proposal_2026.pdf",
      "pages": 7,
      "extracted_at": "2026-05-02T09:14:33Z",
      "extractor": "claim-extract-v3"
    },
    "fields": {
      "insured_name": {
        "value": "Globex Corp.",
        "raw_text": "Named Insured:  Globex Corp.",
        "confidence": 0.96,
        "page": 1
      },
      "policy_number": {
        "value": "WC-2026-44210",
        "raw_text": "Renewal Policy No.: WC-2026-44210 (renewal of WC-2025-44210)",
        "confidence": 0.93,
        "page": 1
      },
      "annual_premium": {
        "value": 21500,
        "raw_text": "Estimated Annual Premium  $21,500.00",
        "confidence": 0.97,
        "page": 2
      },
      "deductible": {
        "value": 5000,
        "raw_text": "Per-Claim Deductible  $5,000",
        "confidence": 0.94,
        "page": 2
      },
      "class_codes": {
        "value": ["8810", "8742", "5403"],
        "raw_text": "Governing Class Codes: 8810 (Clerical), 8742 (Outside Sales), 5403 (Carpentry — NEW)",
        "confidence": 0.79,
        "page": 3
      }
    },
    "unparsed_sections": [
      {
        "label": "CARRIER COVER LETTER",
        "page": 1,
        "text": "Dear Broker, We are pleased to offer renewal terms for Globex Corporation effective 07/01/2026. Please note the following modifications from the expiring policy: (1) The per-claim deductible now applies on a per-occurrence basis, not aggregate. (2) Exclusion EXC-1142 (Assault & Battery) has been added. (3) Audit period adjusted to 90 days post-expiration. We look forward to binding by 06/15."
      },
      {
        "label": "ENDORSEMENT SCHEDULE",
        "page": 5,
        "text": "Endt #1  WC 00 04 14   Notice of Cancellation\nEndt #2  WC 04 03 01   Experience Rating Modification — 1.07\nEndt #3  EXC-1142      Assault & Battery Exclusion (NEW)\nEndt #4  WC 00 03 13   Waiver of Our Right to Recover from Others"
      }
    ],
    "warnings": [
      "class_codes: confidence 0.79 — third code (5403) labelled NEW in source",
      "narrative contains coverage modifications not promoted to structured fields"
    ]
  }
  $json$::jsonb
);

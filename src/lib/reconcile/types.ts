/**
 * The discrepancy taxonomy from docs/onsite-prep.md. Five tiers, ordered
 * cheapest → most expensive to resolve. The UI color-codes by this enum
 * and the queue sorts by it.
 */
export type DiscrepancyTier =
  | 'cosmetic' // whitespace, casing, "Inc" vs "Inc." — auto-resolve, don't surface
  | 'auto_resolved' // reconcilable by rules (date-format, sub-tolerance numeric)
  | 'material' // unambiguous, worth a reviewer's attention (limit dropped, AI removed)
  | 'ambiguous' // low-confidence extraction or multi-match — needs disambiguation
  | 'out_of_distribution'; // structurally unexpected — escalate, don't pretend

/**
 * One typed field extracted from a document. The shape mirrors what a real
 * extractor (Textract, Reducto, an in-house Claude pass) emits: a typed
 * `value`, the verbatim `raw_text` it came from, a confidence score, and
 * positional metadata so the reviewer can locate it in the source PDF.
 *
 * Low `confidence` is the strongest signal for the `ambiguous` tier.
 */
export interface ExtractionField {
  value: unknown;
  raw_text?: string;
  confidence?: number;
  page?: number;
  bbox?: [number, number, number, number];
}

/**
 * A free-text region the extractor could not promote to a structured field.
 * Cover letters, endorsement schedules, "Description of Operations" blocks.
 * Material coverage changes hide here disproportionately often — this is
 * the half of the document the rules engine cannot see.
 */
export interface UnparsedSection {
  label: string;
  text: string;
  page?: number;
}

/**
 * Full extraction envelope. The pipeline treats `fields` as the typed slots
 * and `unparsed_sections` as material that only the LLM can read.
 */
export interface ExtractedDocument {
  source?: {
    filename?: string;
    pages?: number;
    extracted_at?: string;
    extractor?: string;
  };
  fields: Record<string, ExtractionField>;
  unparsed_sections?: UnparsedSection[];
  warnings?: string[];
}

/**
 * System-of-record row. Authoritative, flat, typed — the brokerage's truth.
 */
export type SystemOfRecord = Record<string, unknown>;

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

/**
 * A discrepancy attached to a specific structured field present in either
 * the system-of-record or the extracted document.
 */
export interface FieldDiscrepancy extends DiscrepancyBase {
  kind: 'field';
  field: string;
  system_value: unknown;
  extracted_value: unknown;
  /** Provenance from the extraction envelope, for click-through to PDF. */
  evidence?: {
    raw_text?: string;
    page?: number;
    extraction_confidence?: number;
  };
}

/**
 * A discrepancy the LLM found in an `unparsed_section` — something the
 * structured fields did not surface. Always `source: 'llm'`; rules can't
 * read free-text. Examples: an exclusion silently added in a cover letter,
 * a deductible application change buried in an endorsement schedule.
 */
export interface NarrativeDiscrepancy extends DiscrepancyBase {
  kind: 'narrative';
  section: string;
  /** Verbatim quote from the source, so the reviewer can verify in seconds. */
  excerpt: string;
  page?: number;
  source: 'llm';
}

export type Discrepancy = FieldDiscrepancy | NarrativeDiscrepancy;

/**
 * One entry in the per-item `decision_log`. Append-only audit trail of
 * what the reviewer (or an auto-resolve rule) did.
 */
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

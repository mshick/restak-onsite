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

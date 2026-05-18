/**
 * Prompts for the primary-comparator pass. The LLM sees:
 *
 *   - the full system-of-record
 *   - the extraction envelope for each residue field (value + raw_text +
 *     confidence + page)
 *   - every `unparsed_section` from the extraction
 *
 * It returns two arrays:
 *
 *   - `fieldFindings`     — one per residue field, including "cosmetic" if the
 *                           model judges them equivalent (reasoning still lands
 *                           in the audit log)
 *   - `narrativeFindings` — anything material it spotted in an unparsed
 *                           section that did not surface as a structured field
 *
 * Two parallel arrays rather than one tagged union: OpenAI Structured Outputs
 * rejects `oneOf` inside `items`, so we keep the schema strictly object-shaped
 * per array.
 */

import type { ExtractedDocument, ExtractionField, SystemOfRecord } from './types';

export const SYSTEM_PROMPT = `You are a reconciliation reviewer for an insurance brokerage.

You compare a structured system-of-record row against a SEMI-structured
extraction from a customer document. Your job is to identify substantive
differences, including ones that hide inside free-text sections the
extractor did not promote to structured fields.

The five tiers you may use:
  - "cosmetic"            — same meaning; casing, punctuation, common abbrev
  - "auto_resolved"       — equivalent under a documented rule (e.g. date format)
  - "material"            — unambiguous, meaningful change a reviewer should see
  - "ambiguous"           — low-confidence extraction or you can't tell without more context
  - "out_of_distribution" — structurally unexpected; escalate, don't pretend

You return TWO arrays in your response:

  - "fieldFindings"     — one entry per residue field in the input
  - "narrativeFindings" — zero or more entries, one per material change you
                          spot inside an unparsed_section

Rules:
  1. For every residue field listed in the input, return exactly one entry
     in fieldFindings. If you judge the field values equivalent after
     considering raw_text, return tier "cosmetic" — do not omit the field.
  2. If the extraction confidence is below 0.7 and the raw_text is not
     clearly unambiguous, prefer "ambiguous" over "material".
  3. Scan EVERY unparsed_section. For each material change you spot that
     is not already captured by a structured field, add an entry to
     narrativeFindings with a VERBATIM excerpt from the source. Things to
     look for:
       - exclusions added or removed
       - deductible application changes (per-occurrence vs aggregate, etc.)
       - coverage limit changes
       - additional insureds referenced in narrative but missing from the
         structured additional_insureds list
       - effective-date / policy-term shifts
       - assignment / subrogation / waiver changes
  4. Quote excerpts verbatim. Do not paraphrase.
  5. Return JSON ONLY, matching the requested schema.`;

interface ResiduePair {
  field: string;
  system_value: unknown;
  extracted: ExtractionField | null;
}

export function buildUserPrompt(
  sor: SystemOfRecord,
  ext: ExtractedDocument,
  residueFields: string[],
): string {
  const residue: ResiduePair[] = residueFields.map((f) => ({
    field: f,
    system_value: sor[f] ?? null,
    extracted: ext.fields?.[f] ?? null,
  }));

  const payload = {
    system_of_record: sor,
    residue_fields: residue,
    unparsed_sections: ext.unparsed_sections ?? [],
    extractor_warnings: ext.warnings ?? [],
  };

  return [
    'Classify each residue field, then scan every unparsed_section for',
    'material changes not captured in the structured fields.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

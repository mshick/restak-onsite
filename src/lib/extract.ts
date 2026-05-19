/**
 * One-shot PDF → ExtractedDocument envelope + best-guess policy match.
 *
 * Used by the queue-page upload flow. We hand the PDF and the brokerage's
 * candidate policies to gpt-5.4-mini in a single call: the model returns
 * the same per-field { value, raw_text, confidence, page } envelope the
 * seed script hand-rolls, plus the `policy_number` it thinks belongs to
 * this document. We never trust the model's match blindly — the route
 * validates it against the candidate list before binding.
 */

import 'server-only';

import { openai } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { ExtractedDocument } from './reconcile';

const OPENAI_MODEL = 'gpt-5.4-mini';

const DOC_TYPES = ['coi', 'certificate', 'renewal', 'endorsement', 'audit', 'other'] as const;

const stringField = z.object({
  value: z.string().nullable(),
  raw_text: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  page: z.number().int().nullable(),
});

const numericField = z.object({
  value: z.number().nullable(),
  raw_text: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  page: z.number().int().nullable(),
});

const responseSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  matched_policy_number: z.string().nullable(),
  match_reason: z.string(),
  reference_slug: z.string(),
  fields: z.object({
    named_insured: stringField,
    contact_name: stringField,
    contact_email: stringField,
    contact_phone: stringField,
    mailing_address: stringField,
    policy_number: stringField,
    carrier: stringField,
    policy_type: stringField,
    effective_date: stringField,
    expiration_date: stringField,
    premium: numericField,
    coverage_limit: numericField,
  }),
  unparsed_sections: z.array(
    z.object({
      label: z.string(),
      page: z.number().int().nullable(),
      text: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

export interface PolicyCandidate {
  policy_number: string;
  account_id: string;
  account_name: string;
  carrier: string;
  policy_type: string;
}

export interface ExtractResult {
  extracted: ExtractedDocument;
  docType: (typeof DOC_TYPES)[number];
  matchedPolicyNumber: string | null;
  matchReason: string;
  referenceSlug: string;
}

const SYSTEM_PROMPT = `You are an extraction service for an insurance brokerage's
reconciliation pipeline. You receive a single PDF (a carrier or vendor document)
and a list of candidate policies the brokerage has on file. Your job:

1. Extract a structured envelope from the PDF. For each of the twelve fields,
   emit { value, raw_text, confidence, page }:
     - "value" is the typed value (string for everything except premium and
       coverage_limit, which are numbers in dollars).
     - "raw_text" is the verbatim string from the document the value came
       from (include the field's surrounding label when present).
     - "confidence" is your honest estimate in [0, 1]. Use < 0.7 for
       truncated, wrapped, or otherwise uncertain extractions.
     - "page" is the 1-indexed page the value was read from.
   If a field is genuinely not present in the document, set "value" to null
   and "confidence" to 0, with raw_text null.

2. Collect every free-text region that did NOT promote to a structured
   field into "unparsed_sections" (label, page, verbatim text). These are
   the cover letters, coverage breakdowns, endorsement schedules,
   classification tables, loss-history blocks. Be generous — material
   coverage changes hide here.

3. Classify the doc_type as one of: coi, certificate, renewal, endorsement,
   audit, other.

4. Match the document to ONE policy from the candidate list using the
   policy_number on the document plus named-insured / carrier as
   tiebreakers. Return that policy's exact policy_number in
   "matched_policy_number". If no candidate is a clear match return null
   and explain in "match_reason".

5. Emit a SHORT uppercase reference_slug for the queue row that follows
   "<ACCOUNT-SHORT>-<TYPE>-<YEAR>-<DOCKIND>" — e.g.
   "SUMMITRIDGE-WC-2025-AUDIT", "GREENFIELD-CGL-2026-RENEWAL".

6. Use "warnings" for extractor-side caveats (truncated fields, ambiguous
   dates, pending values). One short sentence per warning.

Do not paraphrase, do not invent fields. JSON only.`;

function buildUserPrompt(candidates: PolicyCandidate[]): string {
  return [
    'Extract the document envelope and pick the matching policy from the candidates below.',
    '',
    'candidates:',
    JSON.stringify(candidates, null, 2),
  ].join('\n');
}

export async function extractFromPdf(
  pdf: Uint8Array,
  filename: string,
  candidates: PolicyCandidate[],
): Promise<ExtractResult> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is not set — cannot extract uploads without an LLM.');
  }

  const { output } = await generateText({
    model: openai(OPENAI_MODEL),
    output: Output.object({ schema: responseSchema, name: 'documentExtraction' }),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(candidates) },
          { type: 'file', data: pdf, mediaType: 'application/pdf', filename },
        ],
      },
    ],
  });

  const extracted: ExtractedDocument = {
    source: {
      filename,
      extracted_at: new Date().toISOString(),
      extractor: `${OPENAI_MODEL}-upload`,
    },
    fields: Object.fromEntries(
      Object.entries(output.fields).map(([k, v]) => [
        k,
        {
          value: v.value,
          raw_text: v.raw_text ?? undefined,
          confidence: v.confidence ?? undefined,
          page: v.page ?? undefined,
        },
      ]),
    ),
    unparsed_sections: output.unparsed_sections.map((s) => ({
      label: s.label,
      page: s.page ?? undefined,
      text: s.text,
    })),
    warnings: output.warnings,
  };

  return {
    extracted,
    docType: output.doc_type,
    matchedPolicyNumber: output.matched_policy_number,
    matchReason: output.match_reason,
    referenceSlug: output.reference_slug,
  };
}

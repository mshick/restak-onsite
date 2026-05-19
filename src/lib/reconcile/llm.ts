/**
 * LLM-comparator pass — the primary comparator in this pipeline.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  This is the seam.
 *  In a semi-structured world the LLM does the bulk of the comparison; the
 *  rules pass is only a pre-filter that hides trivially-equivalent fields.
 *  Swap models, prompts, or providers here without touching callers.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Uses Vercel `ai` + `@ai-sdk/openai` with structured output
 * (`generateText` + `Output.object`) so we never have to parse free-form
 * JSON. Falls back to a "needs review" stub when `OPENAI_API_KEY` is
 * empty or unset, so the UI keeps working offline.
 */

import 'server-only';

import { openai } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompts';
import type { Discrepancy, ExtractedDocument, SystemOfRecord } from './types';

// OPENAI_MODEL options — verified against OpenAI docs (May 2026).
//
//   'gpt-5.5'      — current frontier. Top accuracy. Slow, $$$$. Use when
//                    the narrative is dense or adversarial.
//   'gpt-5.4'      — previous-gen frontier. Strong accuracy, faster, $$$.
//                    Solid drop-in if 5.5 is rate-limited.
//   'gpt-5.4-mini' — DEFAULT. Compact 5.4. $$. Smoke-tested on this pipeline:
//                    ~5s/call, catches load-bearing narrative findings. Best
//                    balance of speed, cost, and accuracy.
//   'gpt-5.4-nano' — cheapest 5.4. $. High-volume / mostly-cosmetic queues.
//   'gpt-5-mini'   — Near-frontier 5-series. $$. Slightly more thorough than
//                    5.4-mini but ~9× slower on this workload.
//   'gpt-5-nano'   — fastest/cheapest 5-series. $. May miss subtle narrative.
//   'gpt-5'        — earlier flagship, configurable reasoning effort.
const OPENAI_MODEL = 'gpt-5.4-mini';

const tierEnum = z.enum([
  'cosmetic',
  'auto_resolved',
  'material',
  'ambiguous',
  'out_of_distribution',
]);

// Two parallel arrays instead of one discriminated-union array.
// OpenAI Structured Outputs rejects `oneOf` inside an `items` schema
// (which is what z.discriminatedUnion compiles to), so we split the
// two shapes at the top level. The model returns both arrays in one call.
// OpenAI Structured Outputs requires every property to appear in `required`,
// so all optional-ish fields are `.nullable()` instead of `.optional()`. The
// model returns explicit `null` when it has no value; we normalize to
// `undefined` before storing.
const fieldFinding = z.object({
  field: z.string(),
  tier: tierEnum,
  summary: z.string(),
  detail: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  suggested_rationale: z.string(),
});

const narrativeFinding = z.object({
  section: z.string(),
  tier: tierEnum,
  summary: z.string(),
  excerpt: z.string(),
  page: z.number().int().nullable(),
  detail: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  suggested_rationale: z.string(),
});

const responseSchema = z.object({
  fieldFindings: z.array(fieldFinding),
  narrativeFindings: z.array(narrativeFinding),
});

/**
 * Run the LLM-comparator pass. Returns one finding per residue field plus
 * any narrative findings the model surfaced from `unparsed_sections`.
 */
export async function compareWithLlm(
  sor: SystemOfRecord,
  ext: ExtractedDocument,
  residueFields: string[],
): Promise<Discrepancy[]> {
  const hasNarrative = (ext.unparsed_sections?.length ?? 0) > 0;
  if (residueFields.length === 0 && !hasNarrative) return [];

  // Trim to defend against the parent-shell-exports-empty-string case
  // (Claude Desktop / various IDE launchers do this). Without the trim,
  // `!""` would still skip the LLM, but a `" "` would slip past `!x`.
  if (!process.env.OPENAI_API_KEY?.trim()) {
    // Offline fallback. Narrative findings can't be faked — only field-level.
    return residueFields.map((field) => stubField(field, sor, ext));
  }

  const { output: structured } = await generateText({
    model: openai(OPENAI_MODEL),
    output: Output.object({ schema: responseSchema, name: 'reconcileFindings' }),
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(sor, ext, residueFields),
  });

  const byField = new Map(structured.fieldFindings.map((f) => [f.field, f]));

  const narrative: Discrepancy[] = structured.narrativeFindings.map((f, i) => ({
    id: `narrative:${f.section}:${i}`,
    kind: 'narrative',
    section: f.section,
    tier: f.tier,
    summary: f.summary,
    detail: f.detail ?? undefined,
    excerpt: f.excerpt,
    page: f.page ?? undefined,
    source: 'llm',
    confidence: f.confidence ?? undefined,
    suggested_rationale: f.suggested_rationale,
    // final_rationale and flag_state are set by the post-process in index.ts
  })) as Discrepancy[];

  const fieldFindings: Discrepancy[] = residueFields.map((field) => {
    const f = byField.get(field);
    if (!f) return stubField(field, sor, ext, 'LLM omitted this field');
    const extField = ext.fields?.[field];
    return {
      id: `${field}:llm`,
      kind: 'field',
      field,
      tier: f.tier,
      summary: f.summary,
      detail: f.detail ?? undefined,
      system_value: sor[field] ?? null,
      extracted_value: extField?.value ?? null,
      source: 'llm',
      confidence: f.confidence ?? undefined,
      suggested_rationale: f.suggested_rationale,
      // final_rationale and flag_state are set by the post-process in index.ts
      evidence: extField
        ? {
            raw_text: extField.raw_text,
            page: extField.page,
            extraction_confidence: extField.confidence,
          }
        : undefined,
    } as Discrepancy;
  });

  return [...fieldFindings, ...narrative];
}

function stubField(
  field: string,
  sor: SystemOfRecord,
  ext: ExtractedDocument,
  reason = 'No LLM configured — needs human review.',
): Discrepancy {
  const extField = ext.fields?.[field];
  return {
    id: `${field}:stub`,
    kind: 'field',
    field,
    tier: 'ambiguous',
    summary: reason,
    system_value: sor[field] ?? null,
    extracted_value: extField?.value ?? null,
    source: 'llm',
    confidence: 0,
    suggested_rationale:
      'Extraction confidence was low; please confirm the value on the source document.',
    // final_rationale and flag_state are set by the post-process in index.ts
    evidence: extField
      ? {
          raw_text: extField.raw_text,
          page: extField.page,
          extraction_confidence: extField.confidence,
        }
      : undefined,
  } as Discrepancy;
}

/**
 * The reconcile pipeline.
 *
 *   rules pass   → marks trivially-equivalent fields as cosmetic/auto_resolved
 *                  (audit-log only; not blocking)
 *   LLM pass     → primary comparator. Sees residue fields + unparsed sections.
 *                  Emits material/ambiguous findings plus any narrative-only
 *                  issues it discovers in free-text sections.
 *
 * Callers (route handlers, server components) import from here. The internal
 * split between `rules.ts` and `llm.ts` is an implementation detail.
 */

import 'server-only';

import { compareWithLlm } from './llm';
import { runRules } from './rules';
import type { Discrepancy, ExtractedDocument, SystemOfRecord } from './types';

export type {
  DecisionLogEntry,
  Discrepancy,
  DiscrepancyTier,
  ExtractedDocument,
  ExtractionField,
  FieldDiscrepancy,
  NarrativeDiscrepancy,
  SystemOfRecord,
  UnparsedSection,
} from './types';

const TIER_ORDER: Record<Discrepancy['tier'], number> = {
  out_of_distribution: 0,
  material: 1,
  ambiguous: 2,
  auto_resolved: 3,
  cosmetic: 4,
};

const INCLUDE_BY_TIER: Record<Discrepancy['tier'], 'include' | 'exclude'> = {
  out_of_distribution: 'include',
  material: 'include',
  ambiguous: 'include',
  auto_resolved: 'exclude',
  cosmetic: 'exclude',
};

/**
 * Ensures every discrepancy leaving the pipeline has the three review-flow
 * fields populated. Rules-emitted findings already have them set (via
 * `withReviewDefaults` in rules.ts); LLM-emitted findings carry
 * `suggested_rationale` but rely on this function to fill in
 * `final_rationale` and `flag_state`.
 *
 * Also guarantees a non-empty `id` as a last-resort safety net.
 */
function withDefaults(d: Discrepancy): Discrepancy {
  return {
    ...d,
    id: d.id || crypto.randomUUID(),
    final_rationale: d.final_rationale ?? d.suggested_rationale,
    flag_state: d.flag_state ?? INCLUDE_BY_TIER[d.tier],
  };
}

export interface ReconcileResult {
  discrepancies: Discrepancy[];
  severity: Discrepancy['tier'] | null;
}

export async function reconcile(
  sor: SystemOfRecord,
  ext: ExtractedDocument,
): Promise<ReconcileResult> {
  const { trivial, residueFields } = runRules(sor, ext);
  const llmFindings = await compareWithLlm(sor, ext, residueFields);
  const all = [...trivial, ...llmFindings]
    .map(withDefaults)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return {
    discrepancies: all,
    severity: all[0]?.tier ?? null,
  };
}

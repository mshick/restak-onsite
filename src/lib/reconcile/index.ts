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
  const all = [...trivial, ...llmFindings].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  return {
    discrepancies: all,
    severity: all[0]?.tier ?? null,
  };
}

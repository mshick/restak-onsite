/**
 * Pre-filter pass. NOT a comparator — its job is to identify the fields the
 * LLM does not need to look at, so the model can focus on judgment work.
 *
 * In the semi-structured world, rules CANNOT classify "material" or
 * "ambiguous" reliably: the same numeric drift can be benign growth or a
 * coverage cut, and only the narrative + cross-field reasoning tells you
 * which. So this pass only emits two tiers:
 *
 *   - `cosmetic`        — string normalizes to the same thing (casing,
 *                         punctuation, common abbrev)
 *   - `auto_resolved`   — equivalent date format, or numeric drift inside
 *                         the configured tolerance
 *
 * Everything else (including any non-trivial difference and any field with
 * extraction confidence below the threshold) is handed to the LLM.
 */

import type { ExtractedDocument, ExtractionField, FieldDiscrepancy, SystemOfRecord } from './types';

const NUMERIC_TOLERANCE = 0.01; // 1% — generous on purpose for v1.
const CONFIDENCE_FLOOR = 0.7; // below this, always escalate to the LLM.

function normalizeString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\binc(orporated)?\b/g, 'inc')
    .replace(/\bcorp(oration)?\b/g, 'corp')
    .replace(/\bllc\b/g, 'llc')
    .replace(/\s+/g, ' ');
}

function tryParseDate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

type Verdict = FieldDiscrepancy | 'match' | 'needs-llm';

function evidence(ext: ExtractionField | undefined): FieldDiscrepancy['evidence'] {
  if (!ext) return undefined;
  return {
    raw_text: ext.raw_text,
    page: ext.page,
    extraction_confidence: ext.confidence,
  };
}

function classify(field: string, sys: unknown, ext: ExtractionField | undefined): Verdict {
  // Field absent from extraction — LLM may find it in an unparsed section,
  // or confirm the doc legitimately omitted it.
  if (!ext || ext.value === undefined || ext.value === null) {
    if (sys === undefined || sys === null) return 'match';
    return 'needs-llm';
  }

  // Extracted with low confidence — never let rules adjudicate.
  if (typeof ext.confidence === 'number' && ext.confidence < CONFIDENCE_FLOOR) {
    return 'needs-llm';
  }

  const extVal = ext.value;

  // Strict equality short-circuit. No discrepancy, no audit entry.
  if (sys === extVal) return 'match';

  if (typeof sys === 'string' && typeof extVal === 'string') {
    const sn = normalizeString(sys);
    const en = normalizeString(extVal);
    if (sn && en && sn === en) {
      return {
        id: `${field}:cosmetic`,
        kind: 'field',
        field,
        tier: 'cosmetic',
        summary: 'Casing/punctuation differs but normalized form matches.',
        system_value: sys,
        extracted_value: extVal,
        source: 'rules',
        confidence: 1,
        evidence: evidence(ext),
      };
    }
    const sd = tryParseDate(sys);
    const ed = tryParseDate(extVal);
    if (sd != null && ed != null && sd === ed) {
      return {
        id: `${field}:date-format`,
        kind: 'field',
        field,
        tier: 'auto_resolved',
        summary: 'Same date, different format.',
        system_value: sys,
        extracted_value: extVal,
        source: 'rules',
        confidence: 1,
        evidence: evidence(ext),
      };
    }
    return 'needs-llm';
  }

  if (typeof sys === 'number' && typeof extVal === 'number') {
    const denom = Math.max(Math.abs(sys), Math.abs(extVal), 1);
    if (Math.abs(sys - extVal) / denom <= NUMERIC_TOLERANCE) {
      return {
        id: `${field}:numeric-drift`,
        kind: 'field',
        field,
        tier: 'auto_resolved',
        summary: `Within ${(NUMERIC_TOLERANCE * 100).toFixed(0)}% tolerance.`,
        system_value: sys,
        extracted_value: extVal,
        source: 'rules',
        confidence: 1,
        evidence: evidence(ext),
      };
    }
    return 'needs-llm';
  }

  if (Array.isArray(sys) && Array.isArray(extVal)) {
    // Set-equality shortcut only. Anything that differs goes to the LLM —
    // a "new class code" in workers' comp can be benign growth or a scope
    // expansion, and only context tells you which.
    const sysSet = new Set(sys.map((x) => normalizeString(x) ?? JSON.stringify(x)));
    const extSet = new Set(extVal.map((x) => normalizeString(x) ?? JSON.stringify(x)));
    const sameSize = sysSet.size === extSet.size;
    const sameMembers = sameSize && [...sysSet].every((x) => extSet.has(x));
    if (sameMembers) return 'match';
    return 'needs-llm';
  }

  return 'needs-llm';
}

export interface PreFilterResult {
  /** Trivial findings: cosmetic + auto_resolved. Logged but not blocking. */
  trivial: FieldDiscrepancy[];
  /** Fields the LLM must judge. May include fields absent from extraction. */
  residueFields: string[];
}

export function runRules(sor: SystemOfRecord, ext: ExtractedDocument): PreFilterResult {
  const trivial: FieldDiscrepancy[] = [];
  const residueFields: string[] = [];

  const sorKeys = Object.keys(sor);
  const extKeys = Object.keys(ext.fields ?? {});
  const allFields = new Set([...sorKeys, ...extKeys]);

  for (const field of allFields) {
    const verdict = classify(field, sor[field], ext.fields?.[field]);
    if (verdict === 'match') continue;
    if (verdict === 'needs-llm') {
      residueFields.push(field);
      continue;
    }
    trivial.push(verdict);
  }

  return { trivial, residueFields };
}

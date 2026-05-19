import type { EmailDraftInput, EmailItem } from './types';

/**
 * Deterministic fallback renderer. Used for the draft-preview state in the
 * UI (no LLM call per keystroke) and as the safe fallback when the email
 * LLM call fails or `OPENAI_API_KEY` is unset.
 */
export function renderTemplate(input: EmailDraftInput): string {
  const { account, policy, document, items, reviewer_notes, reviewer_name } = input;

  const subject = `Subject: Renewal review — ${account.name} / ${policy.number}`;
  const opener = [
    `Hi ${policy.carrier} team,`,
    '',
    `We've reviewed the ${document.doc_type} for ${account.name} (account ${account.id})`,
    `against our records${policy.effective_date ? ` for policy ${policy.number} effective ${policy.effective_date}` : ''}`,
    `and have the following items to clarify before we can confirm placement:`,
  ].join(' ').replace(/\s+/g, ' ');

  const bullets = items.length
    ? items.map((item, i) => formatItem(item, i + 1)).join('\n\n')
    : '_No items flagged for clarification._';

  const notesBlock = reviewer_notes?.trim()
    ? `\n\nAdditional notes:\n${reviewer_notes.trim()}\n`
    : '';

  const signoff = `Thanks,\n${reviewer_name}`;

  return [subject, '', opener, '', bullets, notesBlock, '', signoff].join('\n');
}

function formatItem(item: EmailItem, n: number): string {
  const lines: string[] = [`${n}. **${item.label}** — ${item.rationale}`];
  if (item.system_value !== undefined) {
    lines.push(`   - System of record: ${item.system_value || '—'}`);
  }
  if (item.extracted_value !== undefined) {
    lines.push(`   - Document: ${item.extracted_value || '—'}`);
  }
  if (typeof item.page === 'number') {
    lines.push(`   - Source: p${item.page}`);
  }
  return lines.join('\n');
}

import type { EmailDraftInput } from './types';

export const EMAIL_SYSTEM_PROMPT = `You are drafting a professional email
from a brokerage account manager to an insurance carrier's underwriter.
Goal: ask the carrier to clarify or correct each listed item before
placement is confirmed.

Hard rules:
  1. DO NOT introduce new findings, add items, or invent details. The
     "items" array is the complete set you may discuss.
  2. DO NOT change the meaning of any item's rationale. You may tighten
     wording but the substance must be preserved.
  3. DO NOT remove items.
  4. You MAY reorder items if it improves readability — material first,
     then ambiguous; otherwise preserve given order.
  5. Tone: professional, neutral, factual. Ask, do not accuse.

Output format (markdown only, no fences):
  - First line:    Subject: <one-line subject>
  - Blank line
  - Salutation:    "Hi <carrier> team,"
  - Blank line
  - Opening sentence referencing the account, policy, and document.
  - Blank line
  - Numbered list. Each item:
      <n>. **<label>** — <rationale>
         - System of record: <system_value>   (omit line if absent)
         - Document: <extracted_value>         (omit line if absent)
         - Source: p<page>                     (omit line if absent)
  - Blank line
  - Optional "Additional notes:" paragraph if reviewer_notes is non-empty.
  - Blank line
  - Sign-off: "Thanks,\\n<reviewer_name>"`;

export function buildEmailUserPrompt(input: EmailDraftInput): string {
  return [
    'Draft the email per the rules. Inputs:',
    '',
    JSON.stringify(input, null, 2),
  ].join('\n');
}

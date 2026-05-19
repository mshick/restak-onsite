import 'server-only';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { EMAIL_SYSTEM_PROMPT, buildEmailUserPrompt } from './prompts';
import { renderTemplate } from './template';
import type { EmailDraftInput, EmailDraftResult } from './types';

const MODEL = 'gpt-5.4-mini';

export async function draftEmail(input: EmailDraftInput): Promise<EmailDraftResult> {
  // Match the pattern from src/lib/reconcile/llm.ts: use process.env directly
  // to handle the empty-string case (some launchers export OPENAI_API_KEY="").
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return { markdown: renderTemplate(input), source: 'template' };
  }
  try {
    const { text } = await generateText({
      model: openai(MODEL),
      system: EMAIL_SYSTEM_PROMPT,
      prompt: buildEmailUserPrompt(input),
    });
    const cleaned = text.trim();
    if (!cleaned) {
      return { markdown: renderTemplate(input), source: 'template' };
    }
    return { markdown: cleaned, source: 'llm' };
  } catch (err) {
    console.error('[email] draftEmail failed; falling back to template', err);
    return { markdown: renderTemplate(input), source: 'template' };
  }
}

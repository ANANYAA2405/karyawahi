/**
 * What the feedback form and the thumbs share with the server: the kinds, the fixed tags and
 * their labels in both languages, and the length limits. No server code here, so the client
 * components can import it.
 */

export const FEEDBACK_KINDS = ['page', 'claude_draft', 'claude_answer'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The quick reasons offered after a thumbs down. Stored as these codes, shown in either language. */
export const FEEDBACK_TAGS = ['wrong_figure', 'unclear', 'not_useful', 'too_long', 'language'] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];

export const TAG_LABEL: Record<FeedbackTag, { en: string; hi: string }> = {
  wrong_figure: { en: 'Wrong figure', hi: 'आँकड़ा गलत' },
  unclear: { en: 'Unclear', hi: 'समझ नहीं आया' },
  not_useful: { en: 'Not useful', hi: 'काम का नहीं' },
  too_long: { en: 'Too long', hi: 'बहुत लंबा' },
  language: { en: 'Language problem', hi: 'भाषा में दिक्कत' },
};

export const KIND_LABEL: Record<FeedbackKind, { en: string; hi: string }> = {
  page: { en: 'Feedback form', hi: 'सुझाव फ़ॉर्म' },
  claude_draft: { en: 'Claude draft', hi: 'Claude का मसौदा' },
  claude_answer: { en: 'Claude chat answer', hi: 'Claude का उत्तर' },
};

export const COMMENT_MAX = 1000;
export const TRYING_MAX = 500;

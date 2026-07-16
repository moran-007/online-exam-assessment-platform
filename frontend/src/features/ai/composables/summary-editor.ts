import type { AiStructuredSummaryContent, AiSummaryClaim } from '../models';

export type SummaryEditor = Record<
  'headline' | 'overview' | 'strengths' | 'risks' | 'actions' | 'needsReview',
  string
>;

const LIST_FIELDS = ['overview', 'strengths', 'risks', 'actions', 'needsReview'] as const;

export function emptySummaryEditor(): SummaryEditor {
  return { headline: '', overview: '', strengths: '', risks: '', actions: '', needsReview: '' };
}

export function populateSummaryEditor(editor: SummaryEditor, value: unknown | null) {
  const content = value === null ? null : structuredContent(value);
  editor.headline = content?.headline.text ?? '';
  for (const field of LIST_FIELDS) {
    editor[field] = (content?.[field] ?? []).map((item) => item.text).join('\n');
  }
  return content;
}

export function summaryContentFromEditor(
  editor: SummaryEditor,
  original: AiStructuredSummaryContent | null,
  fallback: string[],
  schemaVersion: string,
) {
  return {
    schemaVersion,
    headline: claim(editor.headline.trim(), original?.headline, fallback),
    overview: claims(editor.overview, original?.overview, fallback),
    strengths: claims(editor.strengths, original?.strengths, fallback),
    risks: claims(editor.risks, original?.risks, fallback),
    actions: claims(editor.actions, original?.actions, fallback),
    needsReview: claims(editor.needsReview, original?.needsReview, fallback),
  } satisfies AiStructuredSummaryContent;
}

function structuredContent(value: unknown): AiStructuredSummaryContent {
  if (!value || typeof value !== 'object') throw new Error('总结内容格式无效');
  return value as AiStructuredSummaryContent;
}

function claim(text: string, existing: AiSummaryClaim | undefined, fallback: string[]) {
  return { text, evidenceRefs: existing?.evidenceRefs?.length ? existing.evidenceRefs : fallback };
}

function claims(text: string, existing: AiSummaryClaim[] | undefined, fallback: string[]) {
  return text.split('\n').map((item) => item.trim()).filter(Boolean)
    .map((item, index) => claim(item, existing?.[index], fallback));
}

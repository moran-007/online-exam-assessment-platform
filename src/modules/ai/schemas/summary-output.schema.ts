export type SummaryClaim = {
  text: string;
  evidenceRefs: string[];
};

export type StructuredSummaryOutput = {
  schemaVersion: string;
  headline: SummaryClaim;
  overview: SummaryClaim[];
  strengths: SummaryClaim[];
  risks: SummaryClaim[];
  actions: SummaryClaim[];
  needsReview: SummaryClaim[];
};

const claimSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'evidenceRefs'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 500 },
    evidenceRefs: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 160 },
    },
  },
} as const;

function createSummarySchema(schemaVersion: string) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: schemaVersion,
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'headline', 'overview', 'strengths', 'risks', 'actions', 'needsReview'],
    properties: {
      schemaVersion: { const: schemaVersion },
      headline: { $ref: '#/$defs/claim' },
      overview: { $ref: '#/$defs/claims' },
      strengths: { $ref: '#/$defs/claims' },
      risks: { $ref: '#/$defs/claims' },
      actions: { $ref: '#/$defs/claims' },
      needsReview: { $ref: '#/$defs/claims' },
    },
    $defs: {
      claim: claimSchema,
      claims: {
        type: 'array',
        maxItems: 20,
        items: { $ref: '#/$defs/claim' },
      },
    },
  } as const;
}

export const EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION = 'exam-summary-output/v1';
export const STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION = 'student-summary-output/v1';

export const EXAM_SUMMARY_OUTPUT_SCHEMA = createSummarySchema(EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION);
export const STUDENT_SUMMARY_OUTPUT_SCHEMA = createSummarySchema(STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION);

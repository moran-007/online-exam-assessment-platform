import { Injectable } from '@nestjs/common';
import type { ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { assertEvidenceIndex, type EvidenceIndex } from '../datasets/evidence-ref';
import {
  EXAM_SUMMARY_OUTPUT_SCHEMA,
  EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
  STUDENT_SUMMARY_OUTPUT_SCHEMA,
  STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION,
  type StructuredSummaryOutput,
} from './summary-output.schema';

export class SummaryOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummaryOutputValidationError';
  }
}

@Injectable()
export class SummaryOutputValidator {
  private readonly validators: Map<string, ValidateFunction>;

  constructor() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    this.validators = new Map([
      [EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION, ajv.compile(EXAM_SUMMARY_OUTPUT_SCHEMA)],
      [STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION, ajv.compile(STUDENT_SUMMARY_OUTPUT_SCHEMA)],
    ]);
  }

  validate(output: unknown, evidenceIndex: EvidenceIndex): StructuredSummaryOutput {
    assertEvidenceIndex(evidenceIndex);
    const schemaVersion = this.schemaVersion(output);
    const validator = this.validators.get(schemaVersion);
    if (!validator) throw new SummaryOutputValidationError(`Unsupported summary schema: ${schemaVersion}`);
    if (!validator(output)) {
      const detail = validator.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
      throw new SummaryOutputValidationError(`Summary output schema validation failed: ${detail || 'unknown error'}`);
    }
    const result = output as StructuredSummaryOutput;
    for (const claim of this.claims(result)) {
      for (const refId of claim.evidenceRefs) {
        if (!evidenceIndex[refId]) {
          throw new SummaryOutputValidationError(`Summary references unknown evidence: ${refId}`);
        }
      }
    }
    return result;
  }

  private schemaVersion(output: unknown) {
    if (!output || typeof output !== 'object' || !('schemaVersion' in output)) {
      throw new SummaryOutputValidationError('Summary output schemaVersion is required.');
    }
    return String(output.schemaVersion);
  }

  private claims(output: StructuredSummaryOutput) {
    return [
      output.headline,
      ...output.overview,
      ...output.strengths,
      ...output.risks,
      ...output.actions,
      ...output.needsReview,
    ];
  }
}

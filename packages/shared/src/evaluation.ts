/** Results of the binding evaluator, keyed by `Entity.property` path. */

export type EvaluationErrorKind = 'syntax' | 'reference' | 'runtime' | 'cycle' | 'timeout';

export interface EvaluationError {
  message: string;
  path: string;
  kind: EvaluationErrorKind;
}

export interface EvaluationResult {
  value: unknown;
  error?: EvaluationError;
}

export type EvaluationMap = Record<string, EvaluationResult>;

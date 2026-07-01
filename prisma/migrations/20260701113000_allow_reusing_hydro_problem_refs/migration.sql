-- Allow multiple local programming questions to reference the same Hydro problem.
DROP INDEX IF EXISTS "programming_problem_refs_judge_provider_external_problem_id_key";

CREATE INDEX IF NOT EXISTS "programming_problem_refs_judge_provider_external_problem_id_idx"
  ON "programming_problem_refs"("judge_provider", "external_problem_id");

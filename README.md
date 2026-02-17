Execution Boundary Interpretation

Deterministic interpretation of AI-generated code mutations at the PR boundary.

What This Is

A GitHub Action that compares:

Declared intent (INTENT.json)
vs
Actual PR mutations

And interprets whether execution boundaries were respected.

It can fail the build if mutations exceed declared limits.

⸻

What It Does
	•	Limits file count
	•	Enforces scope boundaries
	•	Detects deletions
	•	Detects renames
	•	Detects directory moves
	•	Produces a structured Job Summary

⸻

What It Does Not Do
	•	Inspect model reasoning
	•	Modify prompts
	•	Intercept tool calls
	•	Run locally
	•	Require a centralized runtime

It operates only at the merge boundary.

Install
- uses: signalprism/execution-boundary-interpretation@v0.1.0
  with:
    intent_path: "INTENT.json"
    fail_on: "scope,file_count,deletions,renames,moves"

Example INTENT.json
{
  "agent": "claude-code",
  "scope": ["src/"],
  "mutation_class": "patch",
  "max_files": 5,
  "allow_deletions": false,
  "allow_renames": false,
  "allow_moves": false
}

Summary

Declared intent → Actual diff → Deterministic boundary interpretation.
// test change

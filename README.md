# Execution Boundary Interpretation

Deterministic authority enforcement for AI-generated pull requests.

[![Prism Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism-gate.yml/badge.svg?branch=main)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism-gate.yml)
![Version](https://img.shields.io/badge/version-v0.2.0--run4-blue)

This GitHub Action evaluates declared declared authority against the actual mutation surface of a pull request.
It does not interpret prompts.
It interprets diffs.

---

## What It Does

When a pull request runs:
1. Computes the actual diff surface.
2. Classifies mutations (dependency changes, workflow edits, secret material, etc.).
3. Infers required authority from a registry.
4. Compares required authority to declared authority.
5. Passes or fails deterministically.
6. Emits a structured meaning artifact for traceability.

---
## Authority Model

Authority is resolved in this order:
1. AUTHORITY_CONTRACT.json (preferred)
2. INTENT.json (legacy fallback)

The declared authority tier is compared against the required authority implied by detected mutation classes.

Example:

dependency.production.modify → required: high
declared_authority: medium
→ Gate fails

---
## Mutation Semantics

Mutation classes are deterministic and registry-driven.

Examples:
- dependency.production.modify
- ci.workflow.modify
- secret.material.add
- runtime.behavior.modify

Each mutation class maps to a dominant action class and minimum authority requirement.

---

## Run-Scoped Artifacts

Each gate execution writes structured artifacts to:
.prism/runs/<sha-timestamp>/
  meaning.json
  mutation_report.json

Artifacts are not overwritten between runs.

meaning.json
Contains:
- authority contract used
- diff summary
- mutation report
- dominant action class
- required vs declared authority
- final decision
- enforcement reasons (if any)

mutation_report.json
- Contains:
- raw mutation findings
- classification metadata
- severity
- implied authority

Example Output
::notice::Authority source: AUTHORITY_CONTRACT.json
::notice::Changed files evaluated: 1
::notice::Mutations: dependency.production.modify(high)
::notice::Run 4 decision: fail
::notice::Dominant action class: dependency_change
::notice::Authority: required=high declared=medium
::error::Gate failed: Authority mismatch: dependency.production.modify implies high, declared medium

---

## Why This Exists

AI agents and automation systems increasingly open pull requests autonomously.

We typically review what changed.
We rarely declare what was authorized to change.

Execution Boundary Interpretation introduces:

- explicit authority declaration
- deterministic mutation evaluation
- contract-bound enforcement
- traceable interpretive artifacts

It establishes an execution boundary between proposal and action.
---
## Minimal Usage
Add the GitHub Action:
- uses: signalprism/execution-boundary-interpretation@vX

Provide either:
- AUTHORITY_CONTRACT.json
- or INTENT.json (legacy)

The gate evaluates the PR diff against declared authority.
---
## Current Status

Run 4 complete:
- Authority Contract integration
- Mutation classification layer
- Deterministic enforcement
- Run-scoped artifacts
- Contract-first authority resolution

---

## License

MIT

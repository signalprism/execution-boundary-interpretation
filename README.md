# Execution Boundary Interpretation

**Deterministic execution boundary for GitHub pull requests.**

Interpret proposed repository mutations, evaluate required authority, and emit a signed Meaning Artifact explaining the CI decision.

---

![Version](https://img.shields.io/badge/version-v0.2.0-blue)
![Node](https://img.shields.io/badge/node-20+-green)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![CI](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/ci.yml/badge.svg)

---

Signals In → Meaning Out

Pull requests cross an **execution boundary** where proposed mutations are interpreted using a pinned Canon bundle and DevOps domain pack before CI decisions are enforced.

---

> This repository demonstrates the DevWedge: a minimal execution boundary that interprets GitHub pull requests before CI execution.

### Interpretation Flow

**`Pull Request → Execution Boundary Runtime → Mutation Classification → Authority Evaluation → Meaning Artifact → CI Enforcement`**

### Step-by-Step

1. **Pull Request arrives**
    
    GitHub provides the changed files and diff.
    
2. **Execution Boundary Runtime loads governance context**
    
    * Canon bundle
        
    * DevOps Domain Pack
        
    * Authority Contract
        
3. **Mutations are classified**
    
    Example mutation classes:
    
    * `ci.workflow.modify`
        
    * `dependency.production.modify`
        
    * `docs.modify`
        
4. **Authority is evaluated**
    
    The runtime compares:
    
    required_authority  
           vs  
    declared_authority
    
5. **Meaning Artifact is produced**
    
    The system emits structured interpretation artifacts:
    
    * `out/meaning.json`  
    * `out/mutation_report.json`
    
6. **CI enforces the result**
    
    The boundary decision determines whether the CI pipeline proceeds.
    

* * *

### Key Properties

- **Deterministic** — Same inputs always produce the same interpretation result.

- **Governed** — Interpretation logic is anchored in a pinned **Canon bundle**.

- **Explainable** — Every decision produces a **Meaning Artifact** describing what was interpreted and why.

- **Attestable** — Artifacts can be **signed and verified** for integrity.

---

## Architecture (Canon → Domain Pack → Boundary → Artifact)

This repo is a **DevWedge execution boundary**: it evaluates GitHub pull request mutations against declared authority and produces an attestable decision record.

**Authority → Interpretation → Enforcement → Artifact**

- **Canon (`canon/`)**: a pinned, versioned governance bundle (authority spine) loaded during interpretation.
- **Domain Pack (`domain-pack/`)**: GitHub PR interpretation logic (mutation catalog, event model, authority mapping).
- **Execution Boundary (`boundary/`)**: the GitHub Action that runs in CI and enforces legitimacy outcomes.
- **Meaning Artifacts (`out/`)**: structured `meaning.json` output that records what was interpreted and why it was allowed/denied.

See [`REPO_MAP.md`](./REPO_MAP.md) for a full map.

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
```json
  .prism/runs/<sha-timestamp>/
  meaning.json
  mutation_report.json
```

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
::notice::Boundary decision: fail
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

Add the GitHub Action to your workflow:

```yaml
- uses: signalprism/execution-boundary-interpretation@v0.2.0


name: Boundary

on: pull_request

jobs:
  boundary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: signalprism/execution-boundary-interpretation@v0.2.0

```
---
## Current Status

Boundary Interpretation complete:
- Authority Contract integration
- Mutation classification layer
- Deterministic enforcement
- Run-scoped artifacts
- Contract-first authority resolution

---

## Hello World: Governed AI Actions (5 minutes)

This demo shows two pull requests:

- **PASS**: docs-only change
- **FAIL**: CI/workflow change (requires higher authority)

### 1) Use the example inputs
See [`examples/hello-world/`](./examples/hello-world/)

- `INTENT.json`
- `AUTHORITY_CONTRACT.json`

### 2) Install the action in your workflow
Use the workflow example in the README (or add your own). The action will emit a Meaning Artifact (default: `meaning.json`).

### 3) Open a PR that edits `README.md`
Expected: CI passes; artifact shows `authorized`.

### 4) Open a PR that edits `.github/workflows/*`
Expected: CI fails closed; artifact shows `denied` (or `conditional`) with reason.

---

## License

Apache License 2.0

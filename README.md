# Execution Boundary Interpretation

Deterministic authority enforcement for AI-generated pull requests.

[![Prism Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism-gate.yml/badge.svg)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml)
![Version](https://img.shields.io/badge/version-v0.2.0-blue)

This GitHub Action evaluates declared intent against the actual PR diff, classifies the dominant action class, computes required authority, and enforces legitimacy before execution.

No model judgment.
No heuristics.
No SaaS dependency.

Interpretation happens before execution.

---

## What It Does

On every pull request:
1. Reads INTENT.json
2. Classifies the PR diff using a surface_registry.yaml
3. Computes required authority from action class
4. Compares against declared authority
5. Emits a meaning artifact
6. Fails or passes deterministically  

If multiple surfaces are modified, the highest required authority wins.

---

## Install
``` yaml
name: Prism Gate

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  prism:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Prism Gate
        uses: signalprism/execution-boundary-interpretation@v0.2.0
        env:
          INTENT_PATH: "INTENT.json"
          REGISTRY_PATH: ".prism/surface_registry.yaml"
          BOOTSTRAP_LOCK_PATH: ".prism/bootstrap.lock"
          MEANING_OUT_PATH: "meaning.json"
```

---

## Required File:
1️⃣ INTENT.json (root)

Every pull request must include an authority declaration.

### Normal Mode

``` json
{
  "mode": "normal",
  "intent": "Describe the purpose of this PR",
  "declared_authority": "low"
}
```
Authority ladder (default ordering):
- low
- medium
- high
---
2️⃣ Surface Registry
```
.prism/surface_registry.yaml
```

Example:
```
version: 1

surfaces:
  dependency_change:
    match:
      - "package.json"
      - "package-lock.json"
    required_authority: high

  workflow_change:
    match:
      - ".github/workflows/**"
    required_authority: high

  doc_change:
    match:
      - "README.md"
      - "docs/**"
    required_authority: low
```
The dominant action class is computed from the PR diff.

Example: Execution Boundary Demo

A pull request bumps package.json.

Surface registry classifies:
```yaml
dependency_change
```
Required authority: high
---
Case 1 — Declared authority: low
```yaml
Interpretive Gate decision: fail
Dominant action class: dependency_change
Authority: required=high declared=low
Gate failed: authority_exceeded:required=high,declared=low
```
PR is blocked.

Case 2 — Declared authority: high
```yaml
Interpretive Gate decision: pass
Dominant action class: dependency_change
Authority: required=high declared=high
```
PR is allowed.
Same diff. Different legitimacy.
---
Meaning Artifact

On every run, the gate emits ```meaning.json``` containing:
- dominant_action_class
- required_authority
- declared_authority
- decision
- canon bundle hash
- promotion metadata
This provides an auditable interpretive trace.
---
Canon Bundle Structure (Run 4)
```yaml
canon_bundle/
  canon.yaml
  layers/
    00_foundation/
    10_org_overlay/
    20_repo_overlay/
  artifacts/
  promotion.yaml
```
Canon separates interpretation from execution logic.

Interpretation is domain-authored and immutable once promoted.
---
Why This Exists

Model safety governs outputs.

Interpretive safety governs whether actions are legitimate before execution.

This action implements a deterministic contract between intent and change at the pull request boundary.

It is a development wedge of Signal & Prism’s broader interpretive control plane.

Interpretation isn’t inferred. It’s designed.
---

## License

MIT

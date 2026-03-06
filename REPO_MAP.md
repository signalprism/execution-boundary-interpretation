# Repo Map — Execution Boundary Interpretation (DevWedge)

This repository implements a Signal & Prism **Execution Boundary** for GitHub pull requests.

It is structured to make the Canon Architecture layers explicit:

**Authority → Interpretation → Enforcement → Artifact**

---

## Canon Architecture Mapping

| Folder | Layer | What it is |
|---|---|---|
| `canon/` | Canon (governance spine) | A pinned, versioned Canon bundle used during CI interpretation. |
| `domain-pack/` | Domain Pack (scoped interpretive logic) | GitHub PR interpretation logic: event model, mutation catalog, authority mapping, interpretation rules. |
| `boundary/` | Execution Boundary (enforcement surface) | The GitHub Action implementation that evaluates PR mutations and enforces outcomes. |
| `out/` | Meaning Artifacts (attestable output) | Default output location for `meaning.json` artifacts (CI runtime). |
| `examples/` | Demo inputs | Hello World example intent + authority contract + expected outcomes. |
| `docs/` | Architecture notes | Short doctrine docs clarifying Canon vs Catalog, and boundary semantics. |

Note: For the current DevWedge implementation, authoritative JSON schemas live in the repository root `schemas/` directory. The Canon bundle currently contains governance modules and bundle metadata, but does not yet embed its own schema copies.

---

## What happens during a CI run (high level)

1. The GitHub Action runs on a pull request.
2. It loads a pinned Canon bundle from `canon/` and verifies integrity.
3. It loads the DevOps domain pack from `domain-pack/`.
4. It reads the declared inputs (`INTENT.json`, `AUTHORITY_CONTRACT.json`).
5. It interprets the proposed mutation and emits a Meaning Artifact (e.g., `meaning.json`).
6. It enforces the legitimacy outcome (pass/fail/conditional) at the CI boundary.

---

## Key outputs

- **Meaning Artifact:** `meaning.json` (location configurable)
- **Gate result:** CI pass/fail (or advisory output depending on posture)

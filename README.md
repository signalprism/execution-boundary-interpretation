![CI](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/ci.yml/badge.svg)

# Execution Boundary Interpretation

Deterministically interpret AI-generated pull request mutations against a declared execution boundary.

This GitHub Action compares a declared `INTENT.json` against the actual PR diff and:

- Interprets side-effects
- Detects scope violations
- Detects excessive file mutations
- Detects undeclared deletions, renames, and moves
- Fails the PR when execution boundaries are exceeded

No model inspection.  
No prompt wrapping.  
No runtime daemon.  

Just:

Declared intent → Actual diff → Deterministic boundary interpretation.

Execution Boundary Interpretation is a simple primitive: declared intent evaluated against actual PR mutations.

---

### What You Get

- Explicit blast-radius control for AI agents
- Deterministic enforcement in CI
- No external service or runtime dependency

---

## Why This Exists

AI agents can generate large or unintended code changes.

Most systems log what happened.

This action interprets what happened against what was declared.

If the declared execution boundary is exceeded, the PR fails.

---

## Installation

Add this to your repository:

`.github/workflows/enforce.yml`

```yaml
name: Execution Boundary Interpretation

on:
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  interpret:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Execution Boundary Interpretation
        uses: signalprism/execution-boundary-interpretation@v0.1.0
        with:
          intent_path: "INTENT.json"
          fail_on: "scope,file_count,deletions,renames,moves"
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

---

## INTENT.json

Place an `INTENT.json` file at your repository root.

Example:

```json
{
  "agent": "claude",
  "scope": ["src/"],
  "mutation_class": "patch",
  "max_files": 5,
  "allow_deletions": false,
  "allow_renames": false,
  "allow_moves": false
}
```

---

## Interpretation Rules

### 1. File Count
Fails if the number of changed files exceeds `max_files`.

### 2. Scope
Fails if changes occur outside declared directory prefixes.

### 3. Deletions
Fails if files are removed but `allow_deletions` is false.

### 4. Renames
Fails if files are renamed but `allow_renames` is false.

### 5. Moves
Fails if directory-level moves occur but `allow_moves` is false.

---

## Example Failure

If an agent declares:

```json
{
  "scope": ["src/"],
  "max_files": 1
}
```

And the PR modifies:

- `src/index.ts`
- `README.md`

The action fails with:

```
[file_count] File count exceeded: 2 > 1
[scope] Out-of-scope mutation detected.
```

---

## What This Is Not

- Not a prompt wrapper
- Not an agent runtime
- Not a model evaluator
- Not a sandbox

It does not interpret why changes happened.

It deterministically interprets what changed.

---

## Versioning

Use a tagged release:

```yaml
uses: signalprism/execution-boundary-interpretation@v0.1.0
```

---

## License

MIT

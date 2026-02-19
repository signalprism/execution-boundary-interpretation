# Execution Boundary Interpretation

Deterministic authority enforcement at the pull request boundary.

[![Prism Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml/badge.svg)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml)
![Version](https://img.shields.io/badge/version-v0.1.3-blue)

AI agents now generate real pull requests in production repositories.

We review what changed.  
We rarely declare what the agent was authorized to change.

Execution Boundary Interpretation enforces both.

---

## Core Primitive

    declared authority → actual PR diff → deterministic boundary interpretation

---

Every pull request must declare its intended authority level.  
The Action compares that declaration against the real mutation surface.

If authority is exceeded, the pull request fails.

---

## What It Enforces

- Dominant mutation surface classification  
- Authority comparison (`low < medium < high < critical`)  
- File-count and line-count limits  
- Deterministic refusal when authority is exceeded  
- One-time bootstrap enforcement for repository genesis  

If multiple surfaces are modified, the highest required authority wins.

---

## Install

```yaml
name: Prism Gate

on:
  pull_request:

jobs:
  prism:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: signalprism/execution-boundary-interpretation@v0.1.3
        with:
          intent_path: "INTENT.json"

---

## Required File: `INTENT.json`

Every pull request must include an authority declaration.

### Normal Mode

``` json
{
  "mode": "normal",
  "intent": "Add pagination to API",
  "declared_authority": "medium",
  "allowed_action_classes": ["code_change", "test_change"]
}
```

---

## Bootstrap Mode (Repository Genesis)

Bootstrap mode is explicitly high-authority.

``` json
{
  "mode": "bootstrap",
  "intent": "Initial repository scaffold",
  "declared_authority": "high",
  "bootstrap_scope": {
    "allowed_paths": ["**"],
    "allowed_action_classes": [
      "new_codebase",
      "code_change",
      "dependency_change",
      "workflow_change",
      "doc_change"
    ],
    "caps": {
      "max_files_added": 600,
      "max_total_loc_added": 50000,
      "max_new_top_level_dirs": 20
    }
  }
}
```

Bootstrap semantics in v0.1.3:

-   `mode: bootstrap` enforces required_authority ≥ **high**
-   Deterministic file and LOC caps apply
-   Bootstrap may execute only once
-   `.prism/bootstrap.lock` seals repository initialization

---

## Local Testing

You can test locally using environment overrides:

``` bash
INTENT_PATH=examples/INTENT.normal.json node src/index.js
```

---

## Why This Exists

AI systems can generate high-quality code.
They do not inherently understand authority boundaries.

Execution Boundary Interpretation introduces an explicit authority contract before merge.

No SaaS.
No runtime service
No model inspection.

Deterministic enforcement at the pull request boundary.

---

## License

MIT

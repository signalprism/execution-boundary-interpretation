# Execution Boundary Interpretation

[![Prism Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml/badge.svg)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml)
[![Release](https://img.shields.io/github/v/release/signalprism/execution-boundary-interpretation)](https://github.com/signalprism/execution-boundary-interpretation/releases)


Deterministic authority enforcement at the pull request boundary.

AI agents now open real pull requests.

We typically review what changed.\
We rarely declare what the agent was authorized to change.

This Action enforces both.

------------------------------------------------------------------------

## What It Does

For every pull request, this Action:

1.  Classifies the dominant action surface\
2.  Infers the required authority\
3.  Compares against declared authority\
4.  Fails if authority is exceeded

No SaaS.\
No runtime.\
No prompt wrapping.\
Deterministic enforcement in CI.

------------------------------------------------------------------------

## Install

``` yaml
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

      - uses: signalprism/execution-boundary-interpretation@v0.1.2
        with:
          intent_path: "INTENT.json"
```

------------------------------------------------------------------------

## Required File: `INTENT.json`

Every pull request must declare its authority.

### Normal Mode (incremental changes)

``` json
{
  "mode": "normal",
  "intent": "Add pagination to API",
  "declared_authority": "medium",
  "allowed_action_classes": ["code_change", "test_change"]
}
```

------------------------------------------------------------------------

## Authority Levels

    low < medium < high < critical

### Example Surface Requirements

  Surface           Required Authority
  ----------------- --------------------
  Documentation     low
  Code changes      medium
  Dependencies      high
  CI/CD workflows   high
  Secrets / keys    critical

If multiple surfaces are modified, the highest required authority wins.

Example:

-   Code change + workflow change\
    → Required authority = **high**

------------------------------------------------------------------------

## Bootstrap Mode (Repository Genesis)

Large initial scaffolds must explicitly declare bootstrap mode.

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

Bootstrap mode:

-   Allows large file introductions
-   Enforces deterministic caps
-   Can only run once
-   Is sealed by `.prism/bootstrap.lock`

After bootstrap, all changes must use normal mode.

------------------------------------------------------------------------

## Deterministic by Design

This Action does **not**:

-   Use machine learning
-   Perform heuristic risk scoring
-   Call external services
-   Modify prompts

It evaluates declared authority against actual diff surfaces using
deterministic rules.

------------------------------------------------------------------------

## Why This Exists

AI agents reason well.

They do not naturally respect authority boundaries.

Execution Boundary Interpretation ensures that:

-   Authority is declared
-   Surfaces are classified
-   Violations fail before merge

Interpretation before execution.

------------------------------------------------------------------------

## Local Testing

You can test locally using environment overrides:

``` bash
INTENT_PATH=examples/INTENT.normal.json node src/index.js
```

------------------------------------------------------------------------

## License

MIT

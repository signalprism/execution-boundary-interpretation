# Execution Boundary Interpretation

Deterministic authority enforcement at the pull request boundary.

[![Prism
Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml/badge.svg)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism.yml)
![Version](https://img.shields.io/badge/version-v0.1.3-blue)

AI agents now open real pull requests in production repositories.

We typically review what changed.\
We rarely declare what the agent was authorized to change.

This Action enforces both.

------------------------------------------------------------------------

## Core Primitive

    declared authority → actual PR diff → deterministic boundary interpretation

------------------------------------------------------------------------

## What It Does

For every pull request, this Action:

1.  Classifies the dominant action surface\
2.  Infers required authority\
3.  Enforces a minimum authority floor when applicable\
4.  Fails if declared authority is exceeded

No SaaS.\
No runtime service.\
No model inspection.

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

      - uses: signalprism/execution-boundary-interpretation@v0.1.3
        with:
          intent_path: "INTENT.json"
```

------------------------------------------------------------------------

## Required File: `INTENT.json`

Every pull request must declare its authority.

### Normal Mode

``` json
{
  "mode": "normal",
  "intent": "Add pagination to API",
  "declared_authority": "medium",
  "allowed_action_classes": ["code_change", "test_change"]
}
```

------------------------------------------------------------------------

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
-   Deterministic caps limit file count and LOC
-   Bootstrap can only execute once
-   `.prism/bootstrap.lock` seals repository genesis

------------------------------------------------------------------------

## Authority Levels

    low < medium < high < critical

If multiple surfaces are modified, the highest required authority wins.

------------------------------------------------------------------------

## Why This Exists

AI agents generate real pull requests.

Execution Boundary Interpretation ensures that:

-   Authority is declared\
-   Mutation surfaces are classified\
-   Violations fail before merge

Interpretation before execution.

Deterministic enforcement at the pull request boundary.

------------------------------------------------------------------------

## Local Testing

You can test locally using environment overrides:

``` bash
INTENT_PATH=examples/INTENT.normal.json node src/index.js
```

------------------------------------------------------------------------

## License

MIT

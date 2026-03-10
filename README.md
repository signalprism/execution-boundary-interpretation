# Execution Boundary Interpretation

**Interpret before execution.**

**Deterministic execution boundaries for autonomous actions and repository mutations.**

Interpret signals, evaluate legitimacy, and enforce authority before CI execution.

* * *

![Version](https://img.shields.io/badge/version-v0.2.0-blue)  
![Node](https://img.shields.io/badge/node-20+-green)  
![License](https://img.shields.io/badge/license-Apache--2.0-blue)  
![CI](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/ci.yml/badge.svg)

* * *

## Signals In → Meaning Out

Automation systems increasingly propose actions.

Execution Boundary Interpretation introduces a **deterministic interpretive layer** between signals and execution.

Signals cross an **execution boundary** where they are interpreted using a pinned Canon bundle and domain packs before CI decisions are enforced.

* * *

## Two Interpretive Boundaries

This repository now demonstrates two stages of interpretive enforcement:

### 1. Agent Action Boundary

Before repository mutations occur, the system evaluates whether the **requested action itself is legitimate**.

Example:

GitHub Event  
   ↓  
Action Request  
   ↓  
Actor Resolution  
   ↓  
Signal Surface Trust  
   ↓  
Authority Evaluation  
   ↓  
Action Decision Artifact

This stage answers:

> **Is this action legitimate for this actor, intent, and signal surface?**

Examples:

| Action | Signal Surface | Decision |
| --- | --- | --- |
| `package.publish` | `github.issue.title` | **deny** |
| `release.create` | `github.release.metadata` | **allow** |

This produces:

action_decision_artifact.json

* * *

### 2. Execution Boundary

If the action is legitimate, repository mutations cross the **execution boundary**.

Pull Request  
   ↓  
Execution Boundary Runtime  
   ↓  
Mutation Classification  
   ↓  
Authority Evaluation  
   ↓  
Meaning Artifact  
   ↓  
CI Enforcement

This stage answers:

> **Are the proposed repository mutations authorized?**

Artifacts produced:

meaning.json  
mutation_report.json

* * *

# Interpretation Flow

Full pipeline:

Signal  
   ↓  
Agent Action Boundary  
   ↓  
Action Decision Artifact  
   ↓  
Pull Request / Repository Mutation  
   ↓  
Execution Boundary Runtime  
   ↓  
Mutation Classification  
   ↓  
Authority Evaluation  
   ↓  
Meaning Artifact  
   ↓  
CI Enforcement

* * *

# Architecture

Canon Bundle  
      ↓  
Domain Pack  
      ↓  
Agent Action Boundary  
      ↓  
Execution Boundary Runtime  
      ↓  
Meaning Artifacts

### Components

**Canon (`canon/`)**

Versioned governance bundle.

Defines schemas and interpretive invariants.

* * *

**Domain Packs**

Interpretive logic for specific environments.

Examples:

GitHub DevOps Domain Pack

Includes:

* mutation class catalog
    
* signal surface registry
    
* actor profiles
    
* action classification
    

* * *

**Execution Boundary (`boundary/`)**

GitHub Action runtime enforcing interpretive decisions.

* * *

**Artifacts**

Structured interpretation outputs:

action_decision_artifact.json  
meaning.json  
mutation_report.json

Artifacts explain:

* what was interpreted
    
* why it was allowed or denied
    
* what authority was required
    

* * *

# Key Properties

**Deterministic**

Same signals produce the same interpretation.

* * *

**Governed**

Interpretation logic is anchored in a pinned Canon bundle.

* * *

**Explainable**

Every decision produces structured artifacts describing:

* actor
    
* signal surface
    
* action
    
* authority
    
* legitimacy decision
    

* * *

**Attestable**

Artifacts can be cryptographically signed and verified.

* * *

# Minimal Usage

Add the GitHub Action:

YAML- uses: signalprism/execution-boundary-interpretation@v0.4.0

Example workflow:

YAMLname: Boundary  
  
on: pull_request  
  
jobs:  
  boundary:  
    runs-on: ubuntu-latest  
    steps:  
      - uses: actions/checkout@v4  
      - uses: signalprism/execution-boundary-interpretation@v0.4.0

* * *

# Example Interpretations

### Denied

Action: package.publish  
Signal: github.issue.title  
Actor: automation  
Decision: deny  
Reason: ACTOR_FORBIDDEN_ACTION

Artifact:

action_decision_artifact.json

* * *

### Allowed

Action: release.create  
Signal: github.release.metadata  
Actor: maintainer  
Decision: allow

Execution proceeds to the mutation boundary.

* * *

# Why This Exists

AI agents increasingly propose actions:

* opening pull requests
    
* publishing packages
    
* triggering workflows
    
* modifying infrastructure
    

We usually inspect **what changed**.

We rarely interpret **whether the action itself was legitimate**.

Execution Boundary Interpretation introduces:

* explicit authority evaluation
    
* signal surface trust evaluation
    
* actor legitimacy evaluation
    
* deterministic enforcement
    
* traceable interpretation artifacts
    

It establishes an interpretive boundary between **signals and execution**.

* * *

# Current Status

DevWedge prototype demonstrating:

* agent action boundary
    
* execution boundary
    
* mutation classification
    
* authority contracts
    
* signal surface trust tiers
    
* deterministic enforcement
    
* structured interpretation artifacts
    

* * *

# License

Apache License 2.0

* * *

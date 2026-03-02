# Execution Boundary Interpretation

**Authority-bound, tamper-evident mutation control for pull requests.**


[![Prism Gate](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism-gate.yml/badge.svg?branch=main)](https://github.com/signalprism/execution-boundary-interpretation/actions/workflows/prism-gate.yml)
![Version](https://img.shields.io/badge/version-v0.3.0--run4-blue)


Execution Boundary Interpretation is a GitHub Action that enforces declared authority contracts against actual repository mutations — and produces a signed interpretation artifact inside CI.

No SaaS.  
No external runtime.  
Deterministic.  
Fail-closed.

* * *

## What It Does

When a pull request is opened:

1. Loads an **authority contract** (`AUTHORITY_CONTRACT.json`)
    
2. Computes the actual mutation surface from the diff
    
3. Classifies mutations against a registry
    
4. Determines required authority
    
5. Produces a **meaning artifact**
    
6. Attaches canonical integrity hashes
    
7. Signs the artifact (GPG, detached)
    
8. Verifies signature inside CI
    

If declared authority is exceeded, the PR fails.

* * *

## Core Model

CodeAuthority Contract  
        ↓  
Diff → Mutation Classification  
        ↓  
Required Authority Inference  
        ↓  
Deterministic Gate Decision  
        ↓  
Signed Interpretation Artifact

* * *

## Authority Contract

Root-level file:

CodeAUTHORITY_CONTRACT.json

Example:

```yaml
JSON{  
  "mode": "normal",  
  "declared_authority": "high",  
  "scope": "ci.workflow.modify"  
}
```

The gate never invents authority.  
It evaluates declared authority against observed mutation classes.

Legacy `INTENT.json` is supported but deprecated.

* * *

## Deterministic Canonicalization

Integrity hashes are computed using:

* Recursive key sorting
    
* Stable JSON serialization (no whitespace)
    
* Diff canonicalization (newline normalized)
    
* SHA-256
    

Hashes included:

* `authority_hash`
    
* `diff_hash`
    
* `artifact_hash`
    

These are bound into the final artifact before signing.

* * *

## Signed Interpretation Artifact

Output artifact schema:

* `sp.gate.meaning_artifact.v0` (current gate output)
    
* or `sp.interpretation_artifact.v2.1` (schema-compatible)
    

Signature properties:

```yaml
JSON"integrity": {  
  "canonicalization": "sp.canonicalization.v1",  
  "hash_algorithm": "sha256",  
  "authority_hash": "...",  
  "diff_hash": "...",  
  "artifact_hash": "...",  
  "signature": "...",  
  "signature_format": "gpg-detached-base64",  
  "signing_key_id": "...",  
  "ci_run_id": "...",  
  "timestamp": "..."  
}
```

Verification is performed inside CI using an ephemeral GNUPGHOME.

* * *

## Installation

Add to `.github/workflows/ci.yml`:

YAML- uses: signalprism/execution-boundary-interpretation@v0.2.0-run4  
  with:  
    intent_path: AUTHORITY_CONTRACT.json

(“intent_path” input retained for compatibility — it now expects authority contract.)

* * *

## CI Flow (Run 4)

1. Select contract source
    
2. Produce stable diff
    
3. Run gate
    
4. Write `.prism/runs/<id>/meaning.json`
    
5. Also write `./meaning.json` (pipeline output)
    
6. Attach integrity hashes
    
7. Sign artifact
    
8. Verify signature
    
9. Upload artifacts
    

Artifacts uploaded:

* `meaning.json`
    
* `meaning.with-integrity.json`
    
* `meaning.signed.json`
    
* `artifact.sig`
    
* `pubkey.asc`
    
* `.prism/runs/...`
    

* * *

## Forensics & Provenance

Every gate run writes:

Code.prism/runs/<sha-timestamp>/  
    meaning.json  
    mutation_report.json

These artifacts allow post-hoc audit and replay.

* * *

## No SaaS Dependency

* No hosted control plane
    
* No external API calls
    
* No central database
    
* Works entirely within GitHub Actions
    

All authority binding and verification occurs inside CI.

* * *

## Security Properties

* Authority must be declared explicitly.
    
* Authority must match mutation class requirements.
    
* Mutation classification is deterministic.
    
* Artifact integrity is cryptographically bound.
    
* Signature verification occurs before pipeline continuation.
    
* Fail-closed behavior.
    

* * *

## Philosophy

Most systems review _what changed_.

This enforces _what was authorized to change_.

Execution Boundary Interpretation ensures:

> Authority is evaluated before reasoning.  
> Legitimacy is bound before execution.  
> Interpretation precedes automation.

* * *

## Status

Run 4 – Authority-Bound Signature Binding  
CI-native, deterministic, production-ready.

* * *


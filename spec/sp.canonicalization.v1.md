# Canonicalization Specification — `sp.canonicalization.v1`

## 1. Status

**Normative.**  
This specification defines the canonicalization algorithm used to produce a deterministic byte sequence for hashing and signature binding of Signal & Prism interpretation artifacts and their dependent boundary inputs.

## 2. Scope

This specification defines canonicalization for:

* **Interpretation Artifact Canonical Form** (for `artifact_hash`)
    
* **Intent Canonical Form** (for `intent_hash`)
    
* **Diff Canonical Form** (for `diff_hash`)
    

It does **not** define signature algorithms, key management, or transport/storage of artifacts.

## 3. Terms

* **MUST / MUST NOT / SHOULD / MAY** are to be interpreted as in RFC 2119.
    
* **UTF-8** refers to Unicode UTF-8 encoding without BOM.
    
* **Byte sequence** means the exact bytes produced after canonicalization, prior to hashing.
    

## 4. Determinism Requirement

Given identical semantic inputs, conforming implementations **MUST** produce identical canonical byte sequences.

A conforming implementation **MUST** be insensitive to:

* JSON whitespace differences
    
* JSON key ordering differences
    
* Line-ending differences (CRLF vs LF) in source inputs
    
* Trailing whitespace differences in textual diff sources
    

## 5. Hash Inputs

Canonicalization produces byte sequences to be hashed via a declared hash algorithm (e.g., SHA-256). The following hashes are defined:

* `intent_hash = H(CANON_INTENT(INTENT.json))`
    
* `diff_hash = H(CANON_DIFF(GIT_DIFF))`
    
* `artifact_hash = H(CANON_ARTIFACT(MEANING_ARTIFACT))`
    

Where `H()` is the selected hash algorithm.

## 6. JSON Canonicalization (General)

Any JSON canonicalization defined by this spec uses the following rules:

### 6.1 Parsing

Implementations **MUST** parse JSON using a standards-compliant JSON parser.

Implementations **MUST NOT** accept non-JSON extensions (comments, trailing commas, NaN/Infinity).

### 6.2 Serialization

After parsing, implementations **MUST** serialize JSON to canonical bytes using:

1. **UTF-8 encoding without BOM**
    
2. **No insignificant whitespace**
    
    * No spaces outside string values
        
    * No indentation
        
    * No trailing newline
        
3. **Object key ordering**
    
    * Object member names **MUST** be serialized in **lexicographic ascending order by Unicode code point**.
        
4. **Array ordering**
    
    * Array element ordering **MUST** be preserved exactly as parsed.
        
5. **Numbers**
    
    * Numbers **MUST** be serialized in a stable decimal form such that the parse→serialize→parse roundtrip preserves the numeric value.
        
    * Implementations **SHOULD** avoid floating point conversion artifacts.
        
    * Implementations **MUST NOT** reformat integers with leading zeros.
        
    * If the implementation cannot guarantee stable numeric formatting, numeric values **MUST** be treated as strings at source (producer requirement).
        
6. **Strings**
    
    * Strings **MUST** be escaped per JSON standard.
        
    * Implementations **MUST NOT** normalize Unicode (no NFC/NFD folding).
        
7. **Booleans / null**
    
    * `true`, `false`, `null` **MUST** be serialized in lowercase.
        

## 7. Canonical Intent (`CANON_INTENT`)

### 7.1 Input

`INTENT.json` as bytes.

### 7.2 Output

Canonical JSON bytes per Section 6.

### 7.3 Rules

* The entire parsed JSON document **MUST** be canonicalized.
    
* Implementations **MUST NOT** drop unknown fields.
    
* Implementations **MUST** preserve array ordering.
    

## 8. Canonical Diff (`CANON_DIFF`)

### 8.1 Input

A textual representation of a git diff for the evaluation scope.

Implementations **MUST** clearly define the diff scope used. For CI-based pull request evaluation, the scope **SHOULD** be the PR diff between the PR head and base as fetched by the workflow.

### 8.2 Output

Canonical diff bytes (UTF-8).

### 8.3 Normalization Rules

A conforming implementation **MUST** normalize the diff text as follows, in order:

1. **Line endings**
    
    * Convert all CRLF (`\r\n`) to LF (`\n`).
        
    * Convert any bare CR (`\r`) to LF (`\n`).
        
2. **Trailing whitespace**
    
    * Remove ASCII spaces (`0x20`) and tabs (`0x09`) at the end of each line.
        
3. **Final newline**
    
    * The canonical diff **MUST** end with a single LF (`\n`).
        
    * If the normalized diff is empty, the canonical diff output **MUST** be exactly a single LF (`\n`).
        
4. **Diff headers**
    
    * The implementation **MUST** include the full diff text, including file headers and hunk headers, unless the Authority Contract explicitly defines a reduced diff format.
        
    * If reduced format is used, it **MUST** be versioned and declared, and the same reduced format **MUST** be used for verification.
        
5. **File ordering**
    
    * If the diff is assembled from multiple sources or files (not a single git-generated diff), file sections **MUST** be ordered lexicographically by the target path (Unicode code point order), and within each file section hunks **MUST** be ordered by ascending original line number.
        

### 8.4 Prohibited Transformations

Implementations **MUST NOT**:

* strip or normalize internal whitespace
    
* rewrite rename/copy metadata
    
* remove context lines
    
* reorder hunks emitted by a single git diff generator
    
* apply text encoding normalization beyond UTF-8 encoding of the final output
    

## 9. Canonical Artifact (`CANON_ARTIFACT`)

### 9.1 Input

A meaning / interpretation artifact JSON document (e.g., `sp.interpretation_artifact.v2` or later).

### 9.2 Output

Canonical JSON bytes per Section 6, with required exclusions.

### 9.3 Integrity Exclusion Rule

To prevent self-referential hashing, the artifact canonicalization **MUST** exclude the `integrity` block (or its successor) from the hash input.

#### 9.3.1 Exclusion Procedure

1. Parse the artifact JSON.
    
2. Remove the top-level key named exactly `"integrity"` if present.
    
3. Canonicalize the resulting JSON per Section 6.
    

If future schemas rename or relocate the integrity block, the schema version **MUST** define the excluded paths explicitly. If no excluded path is defined, implementations **MUST** treat `"integrity"` at the top level as the excluded path by default.

### 9.4 Required Binding Fields

An artifact intended for signature binding **MUST** contain, at minimum:

* A schema identifier (e.g., `schema`)
    
* A stable event identity payload sufficient to relate the artifact to the evaluated boundary (e.g., PR number + repo + head SHA, or equivalent)
    
* A declared intent reference (either embedded `declared` object or an `intent_hash`)
    

(These requirements are for meaningful binding; verification can still occur without them, but the artifact is not considered a compliant binding target.)

## 10. Verification Canonicalization

Any verifier **MUST**:

* Recompute canonical forms using the same algorithm version (`sp.canonicalization.v1`)
    
* Use the same declared hash algorithm
    
* Compare computed hashes to the values inside the artifact `integrity` block (or external envelope)
    
* Verify the signature against the canonical artifact bytes (excluding integrity)
    

A verifier **MUST** reject verification if:

* Hashes do not match
    
* Signature verification fails
    
* Canonicalization version is unknown or unsupported
    

## 11. Versioning and Compatibility

* This spec defines `sp.canonicalization.v1`.
    
* Any backward-incompatible changes **MUST** increment the version.
    
* Implementations **MAY** support multiple versions concurrently.
    
* Artifacts **MUST** declare which canonicalization version was used (e.g., `integrity.canonicalization = "sp.canonicalization.v1"`).
    

## 12. Security Considerations

* Canonicalization provides **tamper-evidence**, not confidentiality.
    
* Implementations **MUST** protect against parser differentials (accepting invalid JSON).
    
* Diff scope definition is security-critical: the same scope **MUST** be used in signing and verification.
    
* Key custody and signature algorithm choice are out of scope but directly affect trust.

# Standards and Conformance Profile

## Scope and reference inputs

This repository is an evidence-oriented assessment utility for trust-list structure, signatures, profiles, trust anchors, certificate chains, and machine-readable audit output. It is not a general-purpose PKI stack, a legal conformance authority, or an ETSI replacement.

The assessment scope includes:

- ETSI TS 119 612 XML Trusted Lists / LoTLs;
- ETSI TS 119 602-style JSON/XML LoTE artifacts, where applicable;
- WE BUILD WP4 LoTL/LoTE profiles;
- EUDI Reference Implementation trusted-list fixtures; and
- Wallet / Verifier trust-chain test-readiness checks for FCAF-style wallet testing.

First-class reference and testing inputs are:

- EUDI RI Trusted List Provider hosted list service: `https://trustedlist.serviceproviders.eudiw.dev/`
- EUDI RI RP Registration Service / guide: `https://registry.serviceproviders.eudiw.dev/guide`
- WE BUILD WP4 LoTL JSON: `https://webuild-consortium.github.io/wp4-trust-group/list_of_trusted_lists.json`
- WE BUILD WP4 LoTL XML: `https://webuild-consortium.github.io/wp4-trust-group/list_of_trusted_lists.xml`

The hosted EUDI RI Trusted List Provider is a reference/testing input, not a production trust source unless explicitly configured as such. Live checks against these URLs are optional/manual; normal tests must not depend on live network access.

## Normative compatibility requirements

### Artifact applicability

- Classify an artifact before applying conformance checks; do not assess every artifact as ETSI TS 119 612.
- XML `TrustServiceStatusList` artifacts may receive ETSI TS 119 612-style checks.
- JSON LoTE/LoTL artifacts are not ETSI TS 119 612 XML artifacts and must report `not_applicable` for TS 119 612.
- Assess JSON LoTE/LoTL under JSON LoTE, ETSI TS 119 602, or WE BUILD profile checks only when those checks are explicitly implemented.
- Plain XMLDSig presence is not full XAdES or ETSI-profile conformance.
- Keep schema, signature, semantic, profile, certificate-validity, and trust-chain-usability results separate.
- Do not report “fully conformant” unless every relevant implemented check passes and the report states the limits of implemented checks.

### EUDI trust model

Do not confuse relying-party end-entity certificates with trusted-list trust anchors. The expected EUDI relying-party authentication chain is:

```text
LoTL / common trust infrastructure
  -> Trusted List or LoTE for Access Certificate Authorities
      -> Access CA trust anchor
          -> Relying Party Instance access certificate / RPAC / WRPAC
              -> OpenID4VP or ISO mdoc request signed by the Relying Party Instance
```

- A Relying Party Instance access certificate is normally carried in the presentation request with intermediates up to, but excluding, the trust anchor.
- Obtain the trust anchor used to validate that chain from the relevant Trusted List or LoTE.
- Do not assume that individual Relying Party end-entity certificates are directly listed as trust anchors, except in an explicitly modelled experimental or negative fixture.
- Classify Access CA, Registration Certificate Provider, Wallet Provider, PID Provider, and Attestation Provider anchors by role/list type before validation.
- Registration certificates and access certificates are distinct: access certificates authenticate the technical party or instance; registration certificates or registrar data describe registered attributes, intended uses, and policy or entitlement information.

For Relying Party / Verifier assessment, represent the chain explicitly:

```text
RPAC / WRPAC end-entity certificate
  -> optional intermediate CA certificates
      -> Access CA trust anchor from TL/LoTE
```

### Findings and evidence

Every finding includes a stable check ID, category, status, severity, message, evidence when available, and artifact applicability where relevant. The JSON report is the primary integration surface; Markdown renders the same assessment data and must not add Markdown-only findings.

Use these distinct statuses: `pass`, `fail`, `warn`, `not_applicable`, `not_checked`, `unsupported`, and `inconclusive`.

Signature and certificate findings report presence, parseability, subject, issuer, serial, validity period, SHA-256 fingerprint when available, whether cryptographic verification was attempted, and its result or reason it was not checked. An embedded signing certificate is not inherently trusted unless the implemented trust model validates it against an explicit anchor or trust list.

When a standard or profile is ambiguous, report that ambiguity rather than inventing normative behaviour. If a check is unimplemented, report `not_checked`; if outside the artifact type, report `not_applicable`; and if blocked by unsupported library behaviour, report the precise limitation.

## Implementation notes

- Keep fetched network activity bounded: respect configured timeout and concurrency; capture HTTP status, final URL, content type, byte length, hash, and error details; and do not make hidden secondary calls other than documented schema/signature dependencies.
- Preserve sufficient original evidence to explain each finding. Report-schema stability is required; round-tripping is not.
- The OpenAPI document is source, not generated decoration, and must stay aligned with implementation and tests when API functionality changes.

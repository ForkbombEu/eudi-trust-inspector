# ETSI TS 119 612 XML LoTL Input Design

## Purpose

Extend the existing List of Trusted Lists audit workflow so that it accepts ETSI TS 119 612 XML LoTL documents as top-level inputs in addition to the currently supported JSON LoTL representation. The XML path must feed the same bounded pointer-audit pipeline and preserve existing JSON behavior.

The implementation targets ETSI TS 119 612 V2.4.1. In particular:

- clause 5.3.3 defines the `TSLType` values used to identify compiled lists of pointers;
- clause 5.3.13 defines `PointersToOtherTSL` as the source of referenced trusted lists; and
- clause 5.3.16 defines `DistributionPoints` as publication locations for the current list, not as child-list references.

## Scope

The change covers top-level LoTL input through the shared core, CLI, HTTP API, and browser audit form. Existing single-artifact XML assessment remains unchanged.

The XML LoTL parser will accept:

- the exact EU LoTL type `http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUlistofthelists`; and
- a non-EU/community type under the ETSI trusted-list type radix whose final component is `<CC>listofthelists`, where `<CC>` is a non-empty uppercase country, region, or multi-state identifier matching `SchemeTerritory`.

An arbitrary purpose-defined `TSLType` URI will not be automatically classified as a LoTL. Supporting one requires a future explicit mapping because its registered semantics cannot be established from the URI syntax alone.

## Architecture

### Format-neutral parsing boundary

`src/lotl.ts` will expose a format-neutral LoTL parser that accepts the input text, detects JSON or XML from its content, and returns the existing `ParsedLotl` normalized model. `parseLotlJson` remains available so existing callers and focused tests do not break.

The audit orchestrator will call the format-neutral parser instead of unconditionally calling `parseLotlJson`. After normalization, pointer concurrency, fetching, artifact assessment, profile checks, fixture-readiness checks, and report rendering continue through the existing shared path.

This boundary avoids converting XML into a synthetic JSON document and avoids duplicating the audit workflow.

### XML document eligibility

The XML parser will require:

1. well-formed XML accepted by the repository's existing secure XML parsing helper;
2. a `TrustServiceStatusList` document element in the canonical ETSI TS 119 612 namespace `http://uri.etsi.org/02231/v2#`;
3. one direct `SchemeInformation` child;
4. one direct `TSLType` whose value is an accepted list-of-lists type; and
5. one direct, non-empty `PointersToOtherTSL` sequence.

The top-level parser is deliberately stricter than generic artifact detection. Namespace compatibility variants that are already recognized for evidence assessment do not become valid standard LoTL orchestration inputs.

### XML normalization

Each direct `PointersToOtherTSL/OtherTSLPointer` entry becomes one `PointerInfo`. The parser will obtain:

- `location` from the direct `TSLLocation`;
- `declared.mimeType` from the pointer's MIME-type qualifier;
- `declared.loteType` from the pointer's `TSLType` qualifier;
- `declared.schemeOperatorName` from the first available pointer scheme-operator name;
- `declared.schemeTerritory` from the pointer scheme-territory qualifier; and
- `declared.pointerCertificateFingerprintsSha256` from X.509 certificates under the pointer's `ServiceDigitalIdentities`.

XML namespaces and element relationships are checked by namespace URI and local name, never by source prefix. Pointer order is preserved and one-based indexes are assigned exactly as in the JSON parser. Duplicate-location calculation remains shared and deterministic.

The normalized summary maps XML scheme information into the existing report fields:

- `SchemeOperatorName` to `schemeOperatorName`;
- `SchemeName` to `schemeName`;
- `TSLType` to the existing `loteType` field;
- `TSLSequenceNumber` to `sequenceNumber`;
- `ListIssueDateTime` to `issueDateTime`; and
- `NextUpdate/dateTime` to `nextUpdate`.

The existing report object structure remains stable. Request-body XML extends the existing input-kind enumeration with `xml`; file and URL inputs retain their current kinds.

### Distribution points

`SchemeInformation/DistributionPoints` is not inspected for child traversal. It remains available to the repository's existing TS 119 612 artifact assessment but contributes no `PointerInfo` entries to a LoTL audit.

### Entry points

The following entry points will share content-based parsing:

- CLI file and URL input;
- `runAuditInMemory`;
- the API URL-based LoTL operation;
- the API request-body LoTL operation; and
- the browser LoTL file picker.

The existing JSON-object API request remains supported. XML is accepted as a string in the existing content-oriented request field. Public API schemas and the OpenAPI source will describe both formats without creating a second XML-only endpoint.

The browser form will allow `.xml` files and its labels, placeholders, validation errors, and help text will say JSON or ETSI TS 119 612 XML LoTL.

## Error handling

Input errors will be explicit and deterministic. They will distinguish at least:

- malformed JSON or XML;
- XML with the wrong document element or namespace;
- missing or duplicate `SchemeInformation`/`TSLType` structures;
- a non-LoTL `TSLType`, including `EUgeneric`;
- a non-EU list-of-lists type whose territory token does not match `SchemeTerritory`;
- missing or empty `PointersToOtherTSL`; and
- a pointer missing a usable `TSLLocation`.

No pointer will be inferred from `DistributionPoints`. Unsupported child MIME types remain represented as pointers and are handled by the existing artifact detection and findings pipeline rather than silently filtered out.

HTTP routes will continue using their established invalid-LoTL error response shape. User-facing wording will no longer label every parse failure as JSON-specific.

## Testing strategy

Implementation follows red-green-refactor.

A small deterministic fixture modeled on the structure of the European Commission LoTL will cover the canonical namespace, `EUlistofthelists`, direct pointer locations, qualifiers, and pointer certificates without committing the live LoTL snapshot.

Focused tests will establish:

- XML LoTL normalization produces the expected summary and pointers;
- the EU type is accepted;
- a matching non-EU/community `<CC>listofthelists` type is accepted;
- JSON parsing remains unchanged;
- `DistributionPoints` never become pointers;
- malformed XML, `EUgeneric`, mismatched community territory, empty pointers, and missing locations fail clearly;
- an in-memory XML LoTL audit reaches the existing pointer-audit pipeline;
- CLI XML file input succeeds;
- API content and URL forms accept XML LoTLs;
- API/OpenAPI and browser upload contracts advertise XML; and
- existing test and build suites remain green.

Normal tests will mock network behavior and will not depend on the live European Commission or WE BUILD endpoints.

## Documentation and compatibility

README CLI, API, and browser instructions will describe XML LoTL support and the ETSI pointer rule. OpenAPI remains the authoritative API document and will be updated with XML examples and format-neutral error language.

No existing JSON field names, CLI flags, endpoints, fetch limits, concurrency behavior, or single-artifact assessment semantics will be removed or renamed.

## Non-goals

- Traversing `DistributionPoints` as child trusted-list references.
- Recursively treating every pointed LoTL as another orchestration root.
- Automatically trusting pointer certificates or the top-level signing certificate.
- Adding live-network tests or committing a full live LoTL snapshot.
- Supporting arbitrary custom list-of-lists type URIs without an explicit registered-type mapping.
- Changing ETSI TS 119 612 conformance findings unrelated to accepting a top-level XML LoTL.

# ETSI TS 119 612 XML LoTL Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept standards-compliant ETSI TS 119 612 XML Lists of Trusted Lists everywhere the application currently accepts a top-level JSON LoTL.

**Architecture:** Add content-based dispatch at the existing `src/lotl.ts` normalization boundary. XML `TrustServiceStatusList` documents are validated as LoTL inputs and normalized into the existing `ParsedLotl`/`PointerInfo` model, after which the current audit, fetch, report, CLI, and API paths remain shared.

**Tech Stack:** TypeScript, Node.js 20+, ESM, `@xmldom/xmldom`, Vitest, Fastify, OpenAPI 3.1 YAML, Commander.

## Global Constraints

- Follow ETSI TS 119 612 V2.4.1 clauses 5.3.3, 5.3.13, and 5.3.16.
- Accept only the canonical XML namespace `http://uri.etsi.org/02231/v2#` for top-level XML LoTL orchestration.
- Accept exact `EUlistofthelists` and ETSI-radix `<CC>listofthelists` types whose uppercase community token equals `SchemeTerritory`.
- Traverse only direct `PointersToOtherTSL/OtherTSLPointer/TSLLocation` entries; never traverse `DistributionPoints`.
- Preserve all existing JSON LoTL behavior, endpoints, CLI flags, fetch bounds, concurrency, single-artifact behavior, and report property names.
- Keep tests deterministic and offline; use small fixtures rather than a live EU LoTL snapshot.
- Add no dependency.
- Use red-green-refactor: every production behavior starts with a focused failing test and the expected failure must be observed.
- Before every commit run `task format` and `task lint`, inspect staged files for secrets, and use the repository's required Conventional Commit body with `reason` and `prompt`.
- Do not push or deploy.

## File map

- Create `test/fixtures/lotl-ts119612.xml`: small canonical ETSI XML LoTL fixture with direct pointer qualifiers and a distinct distribution URI.
- Create `test/audit.test.ts`: shared-core and file-input regression coverage for XML LoTL orchestration.
- Modify `src/lotl.ts`: format dispatch, XML validation/normalization, parse error typing, and shared summary calculation.
- Modify `test/lotl.test.ts`: parser acceptance, normalization, and rejection coverage.
- Modify `src/types.ts`: add `xml` to the report input-kind union.
- Modify `src/audit.ts`: use the format-neutral parser and add a request-content entry point.
- Modify `src/cli.ts`: format-neutral CLI description and input help.
- Modify `src/api/routes.ts`: use format-neutral parsing for parse/content routes while retaining the JSON-specific route.
- Modify `src/api/server.ts`: preserve `invalid_lotl_json` and add XML/generic LoTL parse error codes.
- Modify `test/api.test.ts`: API content, URL, parse, error, UI, and OpenAPI regressions.
- Modify `src/api/auditUi.ts`: allow and describe XML LoTL upload.
- Modify `openapi/we-build-tl-audit.openapi.yaml`: document XML LoTL request/response behavior and examples.
- Modify `README.md`: document XML LoTL usage and the `PointersToOtherTSL` rule.
- Modify `package.json`: make the package description format-neutral.

---

### Task 1: Normalize ETSI TS 119 612 XML LoTL documents

**Files:**
- Create: `test/fixtures/lotl-ts119612.xml`
- Modify: `test/lotl.test.ts`
- Modify: `src/lotl.ts`

**Interfaces:**
- Produces: `LotlFormat = "json" | "xml"`
- Produces: `LotlParseError extends SyntaxError` with `format: LotlFormat | "unknown"`
- Produces: `parseLotl(text: string): ParsedLotl`
- Preserves: `parseLotlJson(text: string): ParsedLotl`
- Extends: `ParsedLotl` with `format: LotlFormat`

- [ ] **Step 1: Create the deterministic XML fixture**

Create `test/fixtures/lotl-ts119612.xml` with this structure. The empty `DigitalId` is populated with the existing deterministic CA certificate by the test helper; the committed XML stays small and contains no live data.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<TrustServiceStatusList
  xmlns="http://uri.etsi.org/02231/v2#"
  xmlns:at="http://uri.etsi.org/02231/v2/additionaltypes#"
  Id="TEST-LOTL"
  TSLTag="http://uri.etsi.org/19612/TSLTag">
  <SchemeInformation>
    <TSLVersionIdentifier>6</TSLVersionIdentifier>
    <TSLSequenceNumber>7</TSLSequenceNumber>
    <TSLType>http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUlistofthelists</TSLType>
    <SchemeOperatorName><Name xml:lang="en">Example Commission</Name></SchemeOperatorName>
    <SchemeName><Name xml:lang="en">EU:Example List of Trusted Lists</Name></SchemeName>
    <SchemeTerritory>EU</SchemeTerritory>
    <PointersToOtherTSL>
      <OtherTSLPointer>
        <ServiceDigitalIdentities>
          <ServiceDigitalIdentity><DigitalId/></ServiceDigitalIdentity>
        </ServiceDigitalIdentities>
        <TSLLocation>https://example.test/member-state.xml</TSLLocation>
        <AdditionalInformation>
          <OtherInformation><TSLType>http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUgeneric</TSLType></OtherInformation>
          <OtherInformation><SchemeOperatorName><Name xml:lang="en">Example Member State</Name></SchemeOperatorName></OtherInformation>
          <OtherInformation><SchemeTerritory>IT</SchemeTerritory></OtherInformation>
          <OtherInformation><at:MimeType>application/vnd.etsi.tsl+xml</at:MimeType></OtherInformation>
        </AdditionalInformation>
      </OtherTSLPointer>
    </PointersToOtherTSL>
    <ListIssueDateTime>2026-08-01T00:00:00Z</ListIssueDateTime>
    <NextUpdate><dateTime>2026-12-01T00:00:00Z</dateTime></NextUpdate>
    <DistributionPoints><URI>https://example.test/this-lotl.xml</URI></DistributionPoints>
  </SchemeInformation>
</TrustServiceStatusList>
```

- [ ] **Step 2: Write the failing acceptance and normalization tests**

Extend `test/lotl.test.ts` with imports for `certificateFingerprintSha256`, `parseLotl`, and `LotlParseError`, then add:

```ts
describe("parseLotl XML", () => {
  it("normalizes a canonical ETSI EU list of trusted lists", async () => {
    const [fixture, certificate] = await Promise.all([
      readFile("test/fixtures/lotl-ts119612.xml", "utf8"),
      readFile("test/fixtures/ts119612-service-ca.cert.pem", "utf8"),
    ]);
    const encoded = certificate.replace(
      /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g,
      "",
    );
    const xml = fixture.replace(
      "<DigitalId/>",
      `<DigitalId><X509Certificate>${encoded}</X509Certificate></DigitalId>`,
    );

    const parsed = parseLotl(xml);

    expect(parsed.format).toBe("xml");
    expect(parsed.summary).toMatchObject({
      schemeOperatorName: "Example Commission",
      schemeName: "EU:Example List of Trusted Lists",
      loteType: "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUlistofthelists",
      sequenceNumber: 7,
      issueDateTime: "2026-08-01T00:00:00Z",
      nextUpdate: "2026-12-01T00:00:00Z",
      pointerCount: 1,
      uniqueLocationCount: 1,
    });
    expect(parsed.pointers[0]).toMatchObject({
      index: 1,
      location: "https://example.test/member-state.xml",
      declared: {
        mimeType: "application/vnd.etsi.tsl+xml",
        loteType: "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUgeneric",
        schemeOperatorName: "Example Member State",
        schemeTerritory: "IT",
        pointerCertificateFingerprintsSha256: [
          certificateFingerprintSha256(encoded),
        ],
      },
    });
    expect(parsed.pointers.map((pointer) => pointer.location)).not.toContain(
      "https://example.test/this-lotl.xml",
    );
  });

  it("retains JSON parsing through content-based dispatch", async () => {
    const parsed = parseLotl(await readFile("test/fixtures/lotl.json", "utf8"));
    expect(parsed.format).toBe("json");
    expect(parsed.summary.pointerCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run the focused tests and observe RED**

Run: `npx vitest run test/lotl.test.ts`

Expected: FAIL because `parseLotl`, `LotlParseError`, and `ParsedLotl.format` do not exist.

- [ ] **Step 4: Implement format dispatch and XML normalization**

In `src/lotl.ts`, import `parseXml` and add the public types and dispatcher:

```ts
import { parseXml } from "./xml/parse.js";

export type LotlFormat = "json" | "xml";

export class LotlParseError extends SyntaxError {
  constructor(
    message: string,
    public readonly format: LotlFormat | "unknown",
  ) {
    super(message);
    this.name = "LotlParseError";
  }
}

export interface ParsedLotl {
  format: LotlFormat;
  // retain the existing raw, pointers, and summary properties
}

export function parseLotl(text: string): ParsedLotl {
  const trimmed = text.trimStart();
  if (!trimmed) throw new LotlParseError("LoTL input is empty.", "unknown");
  return trimmed.startsWith("<") ? parseLotlXml(text) : parseLotlJson(text);
}
```

Wrap `JSON.parse` so JSON errors retain a stable format discriminator, set `format: "json"`, and move duplicate counting into one helper used by both parsers:

```ts
export function parseLotlJson(text: string): ParsedLotl {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new LotlParseError(
      `Invalid JSON LoTL: ${cause instanceof Error ? cause.message : String(cause)}`,
      "json",
    );
  }
  // retain current JSON field and pointer extraction
  return parsedLotl("json", raw, pointers, {
    schemeOperatorName: firstString(getPath(info, ["SchemeOperatorName"])),
    schemeName: firstString(getPath(info, ["SchemeName"])),
    loteType: firstString(getPath(info, ["LoTEType"])),
    sequenceNumber: numberValue(getPath(info, ["LoTESequenceNumber"])),
    issueDateTime: firstString(getPath(info, ["ListIssueDateTime"])),
    nextUpdate: firstString(getPath(info, ["NextUpdate"])),
  });
}
```

Implement `parseLotlXml` with direct-child helpers that require both local name and the canonical namespace. Use these exact type rules:

```ts
const TSL_NS = "http://uri.etsi.org/02231/v2#";
const ADDITIONAL_TYPES_NS = "http://uri.etsi.org/02231/v2/additionaltypes#";
const TSL_TYPE_RADIX = "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/";
const EU_LOTL_TYPE = `${TSL_TYPE_RADIX}EUlistofthelists`;

function acceptedLotlType(type: string, territory: string): boolean {
  if (type === EU_LOTL_TYPE) return territory === "EU";
  const match = type.match(
    /^http:\/\/uri\.etsi\.org\/TrstSvc\/TrustedList\/TSLType\/([A-Z][A-Z0-9-]*)listofthelists$/,
  );
  return Boolean(match && match[1] !== "EU" && match[1] === territory);
}
```

`parseLotlXml` must:

1. reject any parser error from `parseXml` with `LotlParseError(..., "xml")`;
2. require the canonical root and exactly one direct `SchemeInformation` and `TSLType`;
3. require an accepted type and exactly one non-empty direct `PointersToOtherTSL`;
4. turn every direct `OtherTSLPointer` into a pointer, throwing when exactly one non-empty direct `TSLLocation` is not present;
5. search qualifiers only below the pointer's direct `AdditionalInformation/OtherInformation` children;
6. accept `MimeType` only in `ADDITIONAL_TYPES_NS` and other qualifiers only in `TSL_NS`;
7. hash every non-empty `X509Certificate` below the pointer's direct `ServiceDigitalIdentities`; and
8. call `parsedLotl("xml", document, pointers, summaryFields)`.

Use explicit messages such as:

```ts
throw new LotlParseError(
  `XML LoTL TSLType '${type}' is not an ETSI list-of-lists type for SchemeTerritory '${territory}'.`,
  "xml",
);
throw new LotlParseError(
  `XML LoTL pointer ${index} must contain exactly one non-empty TSLLocation.`,
  "xml",
);
```

- [ ] **Step 5: Run the focused tests and observe GREEN**

Run: `npx vitest run test/lotl.test.ts`

Expected: PASS, including the two pre-existing JSON tests.

- [ ] **Step 6: Write failing standards-boundary tests**

Add table-driven cases to `test/lotl.test.ts`:

```ts
it("accepts a matching non-EU community list-of-lists type", async () => {
  const xml = (await readFile("test/fixtures/lotl-ts119612.xml", "utf8"))
    .replaceAll("EUlistofthelists", "GCClistofthelists")
    .replace("<SchemeTerritory>EU</SchemeTerritory>", "<SchemeTerritory>GCC</SchemeTerritory>");
  expect(parseLotl(xml).summary.loteType).toContain("GCClistofthelists");
});

it.each([
  ["EUgeneric", "EU", "not an ETSI list-of-lists type"],
  ["GCClistofthelists", "AP", "not an ETSI list-of-lists type"],
] as const)("rejects invalid XML LoTL type %s for %s", async (suffix, territory, message) => {
  const xml = (await readFile("test/fixtures/lotl-ts119612.xml", "utf8"))
    .replace("EUlistofthelists", suffix)
    .replace("<SchemeTerritory>EU</SchemeTerritory>", `<SchemeTerritory>${territory}</SchemeTerritory>`);
  expect(() => parseLotl(xml)).toThrow(message);
});

it("rejects malformed XML LoTL structure", async () => {
  const fixture = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
  const cases = [
    {
      xml: fixture.replace(
        'xmlns="http://uri.etsi.org/02231/v2#"',
        'xmlns="https://example.test/not-etsi"',
      ),
      message: "canonical ETSI",
    },
    {
      xml: fixture.replace(
        /<PointersToOtherTSL>[\s\S]*<\/PointersToOtherTSL>/,
        "<PointersToOtherTSL/>",
      ),
      message: "non-empty PointersToOtherTSL",
    },
    {
      xml: fixture.replace(
        "<TSLLocation>https://example.test/member-state.xml</TSLLocation>",
        "",
      ),
      message: "TSLLocation",
    },
  ];
  for (const { xml, message } of cases) {
    expect(() => parseLotl(xml)).toThrow(message);
  }
});

it("labels malformed XML as an XML LoTL parse error", () => {
  try {
    parseLotl("<TrustServiceStatusList>");
    throw new Error("Expected XML parsing to fail");
  } catch (cause) {
    expect(cause).toBeInstanceOf(LotlParseError);
    expect((cause as LotlParseError).format).toBe("xml");
  }
});
```

- [ ] **Step 7: Run the boundary tests and observe RED**

Run: `npx vitest run test/lotl.test.ts`

Expected: at least one rejection case fails until all structural checks and error messages are implemented.

- [ ] **Step 8: Complete the minimal validation logic**

Add only the checks required by Step 6. Do not invoke full XSD or signature assessment from the input parser; those remain separate assessment domains.

- [ ] **Step 9: Run focused and baseline parser tests**

Run: `npx vitest run test/lotl.test.ts test/detect.test.ts test/ts119612Pointers.test.ts`

Expected: PASS.

- [ ] **Step 10: Format, lint, stage, inspect, and commit**

Run:

```bash
task format
task lint
git add src/lotl.ts test/lotl.test.ts test/fixtures/lotl-ts119612.xml
git diff --cached --check
git diff --cached
git commit -m "feat(lotl): parse etsi xml list inputs" -m "reason:
Normalize standards-compliant XML LoTL pointers through the existing audit model.

prompt:
Accept Lists of Trusted Lists in XML format."
```

Expected: formatting and lint pass; staged content contains only the parser, fixture, and tests; commit succeeds.

---

### Task 2: Route XML LoTLs through the shared audit and CLI path

**Files:**
- Create: `test/audit.test.ts`
- Modify: `src/types.ts:237-248`
- Modify: `src/audit.ts:24-130,182-214`
- Modify: `src/cli.ts:10-16`
- Modify: `README.md`

**Interfaces:**
- Consumes: `parseLotl(text: string): ParsedLotl`
- Produces: `runAuditFromContent(content: string, options: AuditCoreOptions, version: string): Promise<AuditInMemoryResult>`
- Extends: `AuditReport.input.kind` to `"file" | "url" | "json" | "xml"`

- [ ] **Step 1: Write failing shared-core and file-input tests**

Create `test/audit.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit, runAuditFromContent } from "../src/audit.js";

const outputs: string[] = [];
const options = {
  concurrency: 1,
  timeoutMs: 1000,
  strict: false,
  includeJsonLoteChecks: true,
  fetch: false,
};

afterEach(async () => {
  await Promise.all(outputs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("XML LoTL audit input", () => {
  it("audits XML request content through the normalized pointer pipeline", async () => {
    const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
    const result = await runAuditFromContent(content, options, "test");
    expect(result.json.input).toMatchObject({ source: "request-body", kind: "xml" });
    expect(result.json.summary.totalPointers).toBe(1);
    expect(result.json.results[0]).toMatchObject({
      location: "https://example.test/member-state.xml",
      fetch: { attempted: false },
    });
  });

  it("accepts an XML LoTL file through the CLI audit backend", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "eudi-trust-inspector-xml-lotl-"));
    outputs.push(outDir);
    const report = await runAudit({
      input: "test/fixtures/lotl-ts119612.xml",
      outDir,
      concurrency: 1,
      timeoutMs: 1000,
      strict: false,
      includeJsonLoteChecks: true,
      fetch: false,
      contextual: false,
    }, "test");
    expect(report.input.kind).toBe("file");
    expect(report.summary.totalPointers).toBe(1);
    expect(JSON.parse(await readFile(join(outDir, "report.json"), "utf8"))).toMatchObject({
      input: { kind: "file" },
      summary: { totalPointers: 1 },
    });
  });
});
```

- [ ] **Step 2: Run the audit test and observe RED**

Run: `npx vitest run test/audit.test.ts`

Expected: FAIL because `runAuditFromContent` does not exist and `runAuditInMemory` still calls `parseLotlJson`.

- [ ] **Step 3: Implement the format-neutral audit entry points**

In `src/types.ts`, add `"xml"` to `AuditReport.input.kind`.

In `src/audit.ts`:

```ts
import { parseLotl, parseLotlJson, type LotlFormat } from "./lotl.js";

export interface InMemoryAuditOptions extends AuditCoreOptions {
  source: string;
  kind: "file" | "url" | LotlFormat;
  lotlText: string;
  sha256?: string;
}

export async function runAuditInMemory(
  options: InMemoryAuditOptions,
  version: string,
): Promise<AuditInMemoryResult> {
  const parsedLotl = parseLotl(options.lotlText);
  // retain the existing orchestration unchanged
}

export async function runAuditFromContent(
  content: string,
  options: AuditCoreOptions,
  version: string,
): Promise<AuditInMemoryResult> {
  const parsed = parseLotl(content);
  return runAuditInMemory({
    ...options,
    source: "request-body",
    kind: parsed.format,
    lotlText: content,
    sha256: sha256Hex(Buffer.from(content, "utf8")),
  }, version);
}
```

Keep `runAuditFromJson` source-compatible and JSON-specific. It must continue serializing objects, call `parseLotlJson(lotlText)` before `runAuditInMemory` so an XML string is rejected by this specifically named entry point, and use `kind: "json"`. The harmless second parse in the request-content entry point is acceptable here because it avoids changing the established `runAuditInMemory` interface or report construction.

Update CLI copy only:

```ts
.description("Audit trusted lists referenced by a JSON or ETSI TS 119 612 XML LoTL.")
.option("--input <path-or-url>", "Local path or URL to a JSON or XML LoTL.")
```

Update the README LoTL guide and CLI table in the same task: state that the CLI accepts JSON or ETSI TS 119 612 XML files/URLs, and add `node dist/cli.js --input ./eu-lotl.xml --out-dir ./audit-output --no-fetch`.

- [ ] **Step 4: Run focused audit and JSON regression tests**

Run: `npx vitest run test/audit.test.ts test/lotl.test.ts test/fixtureReadiness.test.ts test/ts119602Context.test.ts`

Expected: PASS; existing `runAuditFromJson` behavior remains green.

- [ ] **Step 5: Format, lint, stage, inspect, and commit**

Run:

```bash
task format
task lint
git add src/types.ts src/audit.ts src/cli.ts test/audit.test.ts README.md
git diff --cached --check
git diff --cached
git commit -m "feat(audit): route xml lotl content" -m "reason:
Reuse the bounded audit pipeline for XML and JSON LoTL inputs.

prompt:
Accept XML LoTL files, URLs, and request content."
```

Expected: focused tests, formatting, and lint pass; commit succeeds.

---

### Task 3: Expose XML LoTL parsing and auditing through the API

**Files:**
- Modify: `test/api.test.ts`
- Modify: `src/api/routes.ts:3-13,42-65,162-234,319-343`
- Modify: `src/api/server.ts:1-72`
- Modify: `README.md`

**Interfaces:**
- Consumes: `parseLotl`, `LotlParseError`, and `runAuditFromContent`
- Preserves: `POST /api/v1/audit/json` as JSON-specific
- Extends: `POST /api/v1/lotl/parse`, `POST /api/audit/lotl`, `POST /api/audit/fixture-readiness`, and URL audit routes to XML LoTL content

- [ ] **Step 1: Write failing API success tests**

Add to `test/api.test.ts`:

```ts
it("parses and audits ETSI XML LoTL content", async () => {
  const app = await buildServer();
  const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
  const parsed = await app.inject({
    method: "POST",
    url: "/api/v1/lotl/parse",
    payload: { lotl: content },
  });
  expect(parsed.statusCode).toBe(200);
  expect(parsed.json().summary.pointerCount).toBe(1);

  const audited = await app.inject({
    method: "POST",
    url: "/api/audit/lotl",
    payload: { content, options: { fetch: false } },
  });
  expect(audited.statusCode).toBe(200);
  expect(audited.json().report).toMatchObject({
    input: { kind: "xml" },
    summary: { totalPointers: 1 },
  });
  await app.close();
});

it("loads an ETSI XML LoTL URL before applying pointer fetch options", async () => {
  const app = await buildServer();
  const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
  globalThis.fetch = vi.fn(async () => new Response(content, {
    status: 200,
    headers: { "content-type": "application/vnd.etsi.tsl+xml" },
  })) as typeof fetch;
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/audit/url",
    payload: { url: "https://example.test/eu-lotl.xml", options: { fetch: false } },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().report).toMatchObject({
    input: { source: "https://example.test/eu-lotl.xml", kind: "url" },
    summary: { totalPointers: 1, fetched: 0 },
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  await app.close();
});
```

- [ ] **Step 2: Run the API success tests and observe RED**

Run: `npx vitest run test/api.test.ts -t "ETSI XML LoTL"`

Expected: FAIL because the parse route and content audit route still call JSON-only functions.

- [ ] **Step 3: Route XML content through the shared parser**

In `src/api/routes.ts`:

```ts
import {
  assessArtifactContent,
  assessArtifactUrl,
  runAuditFromContent,
  runAuditFromJson,
  runAuditFromUrl,
} from "../audit.js";
import { parseLotl } from "../lotl.js";

// /api/v1/lotl/parse
const parsed = parseLotl(lotlText(request.body.lotl));

// auditLotl after the URL branch
if (body.content !== undefined) {
  return runAuditFromContent(body.content, auditOptions, routeOptions.version);
}
return runAuditFromJson(body.lotl, auditOptions, routeOptions.version);
```

Do not change `/api/v1/audit/json`; its name and contract remain JSON-specific.

- [ ] **Step 4: Run the API success tests and observe GREEN**

Run: `npx vitest run test/api.test.ts -t "ETSI XML LoTL"`

Expected: PASS.

- [ ] **Step 5: Write failing format-specific API error tests**

Add:

```ts
it("returns format-specific 400 errors for invalid LoTL content", async () => {
  const app = await buildServer();
  const invalidXml = await app.inject({
    method: "POST",
    url: "/api/audit/lotl",
    payload: { content: "<TrustServiceStatusList>" },
  });
  expect(invalidXml.statusCode).toBe(400);
  expect(invalidXml.json()).toMatchObject({
    error: { code: "invalid_lotl_xml" },
  });

  const invalidJson = await app.inject({
    method: "POST",
    url: "/api/v1/audit/json",
    payload: { lotl: "{" },
  });
  expect(invalidJson.statusCode).toBe(400);
  expect(invalidJson.json()).toMatchObject({
    error: { code: "invalid_lotl_json" },
  });

  const xmlOnJsonEndpoint = await app.inject({
    method: "POST",
    url: "/api/v1/audit/json",
    payload: { lotl: await readFile("test/fixtures/lotl-ts119612.xml", "utf8") },
  });
  expect(xmlOnJsonEndpoint.statusCode).toBe(400);
  expect(xmlOnJsonEndpoint.json()).toMatchObject({
    error: { code: "invalid_lotl_json" },
  });
  await app.close();
});
```

- [ ] **Step 6: Run the error test and observe RED**

Run: `npx vitest run test/api.test.ts -t "format-specific 400 errors"`

Expected: XML currently returns 500 or the JSON-specific code.

- [ ] **Step 7: Add format-specific parse error handling**

In `src/api/server.ts`, import `LotlParseError` and handle it before generic `SyntaxError`:

```ts
if (error instanceof LotlParseError) {
  const code = error.format === "unknown" ? "invalid_lotl" : `invalid_lotl_${error.format}`;
  reply.status(400).send({ error: { code, message: error.message } });
  return;
}
```

Retain the existing generic `SyntaxError` branch with `invalid_lotl_json` for backward compatibility.

Update the README API table in this task with an XML URL audit example using `POST /api/v1/audit/url`, `https://ec.europa.eu/tools/lotl/eu-lotl.xml`, and `options.fetch: false`.

- [ ] **Step 8: Run all API tests**

Run: `npx vitest run test/api.test.ts`

Expected: PASS.

- [ ] **Step 9: Format, lint, stage, inspect, and commit**

Run:

```bash
task format
task lint
git add src/api/routes.ts src/api/server.ts test/api.test.ts README.md
git diff --cached --check
git diff --cached
git commit -m "feat(api): accept xml lotl requests" -m "reason:
Expose standards-compliant XML LoTL parsing without duplicating API workflows.

prompt:
Accept XML LoTL content and URLs through the API."
```

Expected: API suite, formatting, and lint pass; commit succeeds.

---

### Task 4: Align UI, OpenAPI, package metadata, and README

**Files:**
- Modify: `test/api.test.ts:578-683,747-794`
- Modify: `src/api/auditUi.ts:33-41,76-87`
- Modify: `openapi/we-build-tl-audit.openapi.yaml:64-140,319-335,425-483,705-744`
- Modify: `README.md`
- Modify: `package.json:4`

**Interfaces:**
- Consumes: XML support from Tasks 1-3
- Extends: browser file accept list with `application/vnd.etsi.tsl+xml,application/xml,text/xml,.xml`
- Extends: OpenAPI `AuditReport.input.kind` with `xml`
- Extends: OpenAPI error codes with `invalid_lotl` and `invalid_lotl_xml` while retaining `invalid_lotl_json`

- [ ] **Step 1: Write failing UI and OpenAPI contract assertions**

Extend the existing API tests:

```ts
// In "serves loadable OpenAPI specs with required paths"
expect(
  parsedJson.components.schemas.AuditReport.properties.input.properties.kind.enum,
).toContain("xml");
expect(parsedJson.components.schemas.ApiErrorResponse.properties.error.properties.code.enum)
  .toEqual(expect.arrayContaining(["invalid_lotl", "invalid_lotl_json", "invalid_lotl_xml"]));
expect(parsedJson.paths["/api/audit/lotl"].post.summary).toContain("XML");
expect(
  parsedJson.paths["/api/v1/audit/url"].post.requestBody.content["application/json"].examples.euXml.value.url,
).toBe("https://ec.europa.eu/tools/lotl/eu-lotl.xml");

// In "serves the local audit interface and its assets"
expect(page.body).toContain("JSON or ETSI TS 119 612 XML LoTL");
expect(page.body).toContain("application/vnd.etsi.tsl+xml");
expect(page.body).toContain(".xml");
expect(script.body).toContain("choose a JSON or XML file");
```

- [ ] **Step 2: Run the public-contract tests and observe RED**

Run: `npx vitest run test/api.test.ts -t "OpenAPI|local audit interface"`

Expected: FAIL on XML wording, enum values, and example.

- [ ] **Step 3: Update browser UI copy and accepted file types**

In `src/api/auditUi.ts`, change the LoTL card to:

```html
<p class="muted">Use a JSON or ETSI TS 119 612 XML LoTL URL, or choose a local file.</p>
...
<input id="lotl-url" type="url" placeholder="https://ec.europa.eu/tools/lotl/eu-lotl.xml" />
...
<span>Upload JSON or XML LoTL file</span>
<input id="lotl-file" type="file" accept="application/vnd.etsi.tsl+xml,application/xml,text/xml,application/json,.xml,.json" />
```

Change the empty-input error to `Provide a LoTL URL or choose a JSON or XML file.` No content-type field is needed because `/api/audit/lotl` dispatches from content.

- [ ] **Step 4: Update the authoritative OpenAPI YAML**

Make these exact contract changes:

- `/api/v1/audit/url` summary: `Audit a JSON or ETSI TS 119 612 XML LoTL loaded from URL`.
- Add an `euXml` example with `url: https://ec.europa.eu/tools/lotl/eu-lotl.xml` and `fetch: false`.
- `/api/v1/lotl/parse` description and string schema mention JSON text or ETSI TS 119 612 XML.
- `/api/audit/lotl` summary: `Audit a LoTL from a URL, JSON object, or JSON/XML content`.
- `LoTLAuditRequest.content` description: `Raw JSON or ETSI TS 119 612 XML LoTL content.`
- `AuditReport.input.kind.enum`: `[file, url, json, xml]`.
- `ApiErrorResponse` code enum: `[invalid_request, invalid_lotl, invalid_lotl_json, invalid_lotl_xml, invalid_url, assessment_failed, internal_error]`.

Do not add an XML-only endpoint or claim arbitrary XML support.

- [ ] **Step 5: Update package and README wording**

Set `package.json` description to:

```json
"description": "Audit Trusted Lists referenced by JSON and ETSI TS 119 612 XML LoTL inputs."
```

Update README:

- Intro/technical specs: explicitly name JSON LoTL and ETSI TS 119 612 XML LoTL input.
- GUI LoTL guide: state that URL/file input accepts `.json` and `.xml`.
- Preserve the XML CLI and API examples added in Tasks 2 and 3.
- Add one sentence: child lists are read from `PointersToOtherTSL`; `DistributionPoints` identifies publication locations of the current list and is not traversed.

- [ ] **Step 6: Run public-contract tests and observe GREEN**

Run: `npx vitest run test/api.test.ts -t "OpenAPI|local audit interface"`

Expected: PASS.

- [ ] **Step 7: Format, lint, stage, inspect, and commit**

Run:

```bash
task format
task lint
git add src/api/auditUi.ts openapi/we-build-tl-audit.openapi.yaml README.md package.json test/api.test.ts
git diff --cached --check
git diff --cached
git commit -m "docs(lotl): publish xml input support" -m "reason:
Keep browser, OpenAPI, CLI guidance, and package metadata aligned with runtime behavior.

prompt:
Advertise standards-compliant XML LoTL input."
```

Expected: tests, formatting, and lint pass; commit succeeds.

---

### Task 5: Complete regression verification

**Files:**
- Verify only; modify a task file only if a verification failure proves a defect in the preceding implementation.

**Interfaces:**
- Consumes: all feature behavior and documentation from Tasks 1-4
- Produces: evidence that the complete repository remains buildable and deterministic

- [ ] **Step 1: Run repository formatting verification**

Run: `task format:check`

Expected: PASS with `package.json` and `Taskfile.yml` unchanged.

- [ ] **Step 2: Run repository lint**

Run: `task lint`

Expected: PASS with no TypeScript or design lint errors.

- [ ] **Step 3: Run the complete deterministic test suite**

Run: `task test`

Expected: PASS with no live network dependency.

- [ ] **Step 4: Build the application**

Run: `task build`

Expected: PASS; TypeScript emits the CLI/API build and copies static assets under ignored `dist/`.

- [ ] **Step 5: Inspect final repository state and commit history**

Run:

```bash
git status --short
git log -5 --oneline
```

Expected: clean working tree and the four feature commits from Tasks 1-4 following the design and plan commits.

- [ ] **Step 6: If verification required a corrective edit, repeat the failing command and commit the fix**

Use the same focused red-green cycle as the originating task, then run `task format`, `task lint`, inspect the exact staged files, and commit with:

```bash
git commit -m "fix(lotl): correct xml input regression" -m "reason:
Resolve the verified regression found during full-suite validation.

prompt:
Complete XML LoTL support with all checks passing."
```

If no corrective edit was needed, do not create an empty commit.

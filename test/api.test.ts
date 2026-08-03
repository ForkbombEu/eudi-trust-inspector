import { readFile } from "node:fs/promises";
import { describe, expect, it, afterEach, vi } from "vitest";
import YAML from "yaml";
import { buildServer } from "../src/api/server.js";
import { parseCompactJades } from "../src/json/jades.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

describe("API server", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("keeps runtime Credimi assets byte-identical to the HITL inputs", async () => {
    await expect(
      readFile(new URL("../src/api/assets/style.css", import.meta.url)),
    ).resolves.toEqual(
      await readFile(new URL("../HITL/style.css", import.meta.url)),
    );
    await expect(
      readFile(new URL("../src/api/assets/credimi_logo.svg", import.meta.url)),
    ).resolves.toEqual(
      await readFile(new URL("../HITL/credimi_logo.svg", import.meta.url)),
    );
    await expect(
      readFile(
        new URL("../src/api/assets/credimi_logo_negative.svg", import.meta.url),
      ),
    ).resolves.toEqual(
      await readFile(
        new URL("../HITL/credimi_logo_negative.svg", import.meta.url),
      ),
    );
  });

  it("returns healthz", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      name: "we-build-tl-audit",
      version: "0.1.0",
    });
    await app.close();
  });

  it("parses LoTL pointers without fetching", async () => {
    const app = await buildServer();
    const lotl = JSON.parse(await readFile("test/fixtures/lotl.json", "utf8"));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/lotl/parse",
      payload: { lotl },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toMatchObject({
      pointerCount: 3,
      uniqueLocationCount: 3,
    });
    expect(body.pointers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 1,
          location: "https://example.test/tl.xml",
        }),
      ]),
    );
    await app.close();
  });

  it("parses ETSI TS 119 612 XML LoTL pointers without fetching", async () => {
    const app = await buildServer();
    const lotl = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/lotl/parse",
      payload: { lotl },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: { pointerCount: 1, uniqueLocationCount: 1 },
      pointers: [{ index: 1, location: "https://example.test/member-state.xml" }],
    });
    await app.close();
  });

  it("audits JSON LoTL and returns JSON report plus Markdown", async () => {
    const app = await buildServer();
    const lotl = JSON.parse(await readFile("test/fixtures/lotl.json", "utf8"));
    const xml = await readFile("test/fixtures/tsl-valid-ish.xml", "utf8");
    const json = await readFile("test/fixtures/json-lote.json", "utf8");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/tl.xml")) {
        return new Response(xml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      if (url.endsWith("/lote.json")) {
        return new Response(json, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("missing", { status: 404, statusText: "Not Found" });
    }) as typeof fetch;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/audit/json",
      payload: {
        lotl,
        options: {
          concurrency: 2,
          timeoutMs: 1000,
          strict: false,
          includeJsonLoteChecks: true,
          fetch: true,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.report.summary.totalPointers).toBe(3);
    expect(body.report.summary.jsonArtifacts).toBe(1);
    expect(body.report.results[1].ts119612.conformanceLevel).toBe(
      "not_applicable",
    );
    expect(body.report.results[1].ts119602.conformanceLevel).toBe(
      "non_conformant",
    );
    expect(body.report.results[1].ts119602Classification).toMatchObject({
      binding: "scheme_explicit_json",
      bindingStatus: "selected",
    });
    expect(body.markdown).toContain("# WE BUILD Trusted List Audit");
    const rendered = await app.inject({
      method: "POST",
      url: "/api/v1/report/markdown",
      payload: { report: body.report },
    });
    expect(rendered.statusCode).toBe(200);
    expect(rendered.json().markdown).toBe(body.markdown);
    await app.close();
  });

  it("assesses a single artifact URL", async () => {
    const app = await buildServer();
    const xml = await readFile("test/fixtures/tsl-valid-ish.xml", "utf8");
    globalThis.fetch = vi.fn(
      async () =>
        new Response(xml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    ) as typeof fetch;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/artifact/assess-url",
      payload: {
        url: "https://example.test/tl.xml",
        declared: {
          mimeType: "application/xml",
          pointerCertificateFingerprintsSha256: [],
        },
        options: {
          timeoutMs: 1000,
          strict: false,
          includeJsonLoteChecks: true,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result).toMatchObject({
      index: 1,
      location: "https://example.test/tl.xml",
      detected: { format: "xml" },
    });
    expect(body.result.ts119612.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "schema.xsd",
          status: "inconclusive",
          evidence: expect.objectContaining({
            selection: expect.objectContaining({
              observedNamespace: "http://uri.etsi.org/19612/v2.4.1#",
            }),
          }),
        }),
      ]),
    );
    await app.close();
  });

  it("exposes the expanded assessment core through POST endpoints", async () => {
    const app = await buildServer();
    const [lotl, xml, signedXml, jades] = await Promise.all([
      readFile("test/fixtures/lotl.json", "utf8"),
      readFile("test/fixtures/tsl-valid-ish.xml", "utf8"),
      readFile("test/fixtures/ts119612-signature-profile.xml", "utf8"),
      readFile("test/fixtures/ts119602-jades-compact.jws", "utf8"),
    ]);
    const lotlResponse = await app.inject({
      method: "POST",
      url: "/api/audit/lotl",
      payload: { content: lotl, options: { fetch: false } },
    });
    expect(lotlResponse.statusCode).toBe(200);
    expect(lotlResponse.json().report.summary.totalPointers).toBe(3);

    const artifactResponse = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: xml,
        source: "fixture.xml",
        contentType: "application/xml",
        options: { strict: false, includeJsonLoteChecks: true },
      },
    });
    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.json().result).toMatchObject({
      source: "fixture.xml",
      fetch: { attempted: false },
      detected: { format: "xml" },
    });

    const eudiRiXml = await readFile(
      "test/fixtures/eudi-ri-ts119612-tl.xml",
      "utf8",
    );
    const profileResponse = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: eudiRiXml,
        source: "https://trustedlist.serviceproviders.eudiw.dev/TL/EU/01.xml",
        contentType: "application/xml",
      },
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json().result).toMatchObject({
      standardApplicability: { eudiTrustRole: "applicable" },
      referenceProfiles: {
        eudiRiTs119612: {
          applicability: "applicable",
          recognized: true,
          observedRoles: ["access_ca_or_wrpac_provider", "wallet_provider"],
        },
      },
    });

    const signingCertificate = signedXml.match(
      /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/,
    )?.[1];
    expect(signingCertificate).toBeDefined();
    const signedArtifactResponse = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: signedXml,
        source: "signed-fixture.xml",
        contentType: "application/xml",
        context: {
          trustedSignerFingerprintsSha256: [
            "f67ceee86d57b888ffac479f1466e7acc38f7e36318cc5374d0fcf3406135efa",
          ],
          ts119612Signer: {
            trustAnchors: [signingCertificate],
            revocation: {
              status: "good",
              source: "deterministic-api-test-status",
              checkedAt: "2026-07-22T10:45:00Z",
              nextUpdate: "2030-07-22T11:00:00Z",
              signerFingerprintSha256:
                "f67ceee86d57b888ffac479f1466e7acc38f7e36318cc5374d0fcf3406135efa",
            },
          },
        },
      },
    });
    expect(signedArtifactResponse.statusCode).toBe(200);
    expect(signedArtifactResponse.json().result.ts119612Coverage).toMatchObject(
      {
        ledger: { total: 69 },
        completeVerdictEligible: false,
        requirements: expect.any(Array),
      },
    );
    expect(
      signedArtifactResponse.json().result.ts119612Coverage.requirements,
    ).toHaveLength(69);
    expect(signedArtifactResponse.json().result.ts119612.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ts119612.signature.certificate_path",
          status: "pass",
        }),
        expect.objectContaining({
          id: "ts119612.signature.revocation",
          status: "pass",
        }),
        expect.objectContaining({
          id: "ts119612.signature.signer_trust",
          status: "pass",
        }),
      ]),
    );

    const jadesResponse = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: jades,
        source: "fixture.jws",
        contentType: "application/jose",
        options: { strict: false },
      },
    });
    expect(jadesResponse.statusCode).toBe(200);
    expect(jadesResponse.json().result).toMatchObject({
      source: "fixture.jws",
      detected: { format: "jws", artifactKind: "json_lote" },
      ts119602: {
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "json_lote.signature.jades_cryptographic_verification_result",
            status: "pass",
          }),
        ]),
      },
      ts119602Coverage: {
        ledger: { total: 81 },
        completeVerdictEligible: false,
        requirements: expect.any(Array),
      },
    });
    expect(
      jadesResponse.json().result.ts119602Coverage.requirements,
    ).toHaveLength(81);

    const chainResponse = await app.inject({
      method: "POST",
      url: "/api/audit/certificate-chain",
      payload: {
        chain: ["malformed-certificate"],
        declaredRole: "access_ca_or_wrpac_provider",
      },
    });
    expect(chainResponse.statusCode).toBe(200);
    expect(chainResponse.json().assessment.chainStructurallyValid).toBe(false);

    const fixtureResponse = await app.inject({
      method: "POST",
      url: "/api/audit/fixture-readiness",
      payload: { lotl: JSON.parse(lotl), options: { fetch: false } },
    });
    expect(fixtureResponse.statusCode).toBe(200);
    expect(fixtureResponse.json()).toMatchObject({
      fixtureReadiness: { verdict: "not_checked" },
      fcafTrustedAuthorities: { scenarios: expect.any(Array) },
      negativeFixtureDescriptors: expect.any(Array),
    });
    await app.close();
  });

  it("audits ETSI TS 119 612 XML LoTL request content", async () => {
    const app = await buildServer();
    const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/lotl",
      payload: { content, options: { fetch: false } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().report).toMatchObject({
      input: { source: "request-body", kind: "xml" },
      summary: { totalPointers: 1, fetched: 0 },
    });
    await app.close();
  });

  it("audits an ETSI TS 119 612 XML LoTL URL without fetching its pointers", async () => {
    const app = await buildServer();
    const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");
    globalThis.fetch = vi.fn(async () => new Response(content, {
      status: 200,
      headers: { "content-type": "application/xml" },
    })) as typeof fetch;

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/audit/url",
      payload: {
        url: "https://example.test/eu-lotl.xml",
        options: { fetch: false },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().report).toMatchObject({
      input: { source: "https://example.test/eu-lotl.xml", kind: "url" },
      summary: { totalPointers: 1, fetched: 0 },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("accepts explicit TS 119 602 contextual evidence without enabling network dereferencing", async () => {
    const app = await buildServer();
    const current = (
      await readFile("test/fixtures/ts119602-context-current.jws", "utf8")
    ).trim();
    const prior = structuredClone(parseCompactJades(current).parsedPayload) as {
      LoTE: {
        ListAndSchemeInformation: {
          LoTESequenceNumber: number;
          ListIssueDateTime: string;
        };
      };
    };
    prior.LoTE.ListAndSchemeInformation.LoTESequenceNumber = 1;
    prior.LoTE.ListAndSchemeInformation.ListIssueDateTime =
      "2026-01-01T00:00:00Z";
    globalThis.fetch = vi.fn();
    const response = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: current,
        source: "current.jws",
        contentType: "application/jose",
        context: {
          dereference: false,
          priorArtifacts: [
            {
              content: JSON.stringify(prior),
              source: "prior.json",
              contentType: "application/json",
            },
          ],
          maxDereferences: 16,
          maxBytesPerArtifact: 1000000,
          concurrency: 2,
          maxTraversalDepth: 2,
          ts119602: {
            expiredServiceStatusUris: ["urn:example:status:expired"],
            resources: [
              {
                location: "https://operator.example.test/wallet-providers",
                sha256: "0".repeat(64),
                assertions: ["scheme_scope_and_context"],
                source: "review-record",
                checkedAt: "2026-07-21T00:00:00Z",
              },
            ],
            authoritative: {
              schemeOperator: {
                source: "official-register",
                checkedAt: "2026-07-21T00:00:00Z",
                names: ["JSON-Operator"],
                postalAddresses: [
                  { streetAddress: "1 Commission Street", country: "EU" },
                ],
                electronicAddresses: [
                  "mailto:operator@example.test",
                  "https://operator.example.test",
                ],
              },
            },
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      ts119602: {
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "ts119602.scheme.sequence.history",
            status: "pass",
          }),
          expect.objectContaining({
            id: "ts119602.scheme.pointers.authentication",
            status: "not_checked",
          }),
          expect.objectContaining({
            id: "ts119602.context.bounds",
            status: "pass",
          }),
        ]),
      },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const invalid = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: current,
        context: { dereference: true, maxDereferences: 33 },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "invalid_request" },
    });

    const invalidDepth = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: current,
        context: { dereference: true, maxTraversalDepth: 9 },
      },
    });
    expect(invalidDepth.statusCode).toBe(400);
    const invalidAssertion = await app.inject({
      method: "POST",
      url: "/api/audit/artifact",
      payload: {
        content: current,
        context: {
          ts119602: {
            resources: [
              {
                location: "https://example.test/page",
                sha256: "0".repeat(64),
                assertions: ["invented_semantics"],
                source: "review",
                checkedAt: "2026-07-21T00:00:00Z",
              },
            ],
          },
        },
      },
    });
    expect(invalidAssertion.statusCode).toBe(400);
    await app.close();
  });

  it("renders Markdown from supplied report", async () => {
    const app = await buildServer();
    const report = {
      schemaVersion: 7,
      tool: { name: "we-build-tl-audit", version: "0.1.0" },
      generatedAt: "2026-07-16T00:00:00.000Z",
      input: { source: "request-body", kind: "json" },
      lotl: { pointerCount: 0, uniqueLocationCount: 0, duplicateLocations: [] },
      weBuildProfile: {
        recognized: false,
        recognitionReasons: [],
        listTypeCounts: {},
        roleCounts: {},
        pointerConsistency: {
          declaredMimeMismatches: 0,
          duplicateLocations: 0,
          pointersMissingServiceDigitalIdentities: 0,
          pointersMissingQualifiers: 0,
          pointerCertificatesParsed: 0,
          pointerCertificatesInvalidAtAssessment: 0,
        },
      },
      fixtureReadiness: {
        usableForWalletTrustFixture: false,
        verdict: "not_checked",
        checks: [],
        caveats: ["No referenced artifact was assessed."],
      },
      fcafTrustedAuthorities: { scenarios: [] },
      negativeFixtureDescriptors: [],
      summary: {
        totalPointers: 0,
        fetched: 0,
        fetchFailed: 0,
        xmlArtifacts: 0,
        jsonArtifacts: 0,
        unknownArtifacts: 0,
        ts119612: {
          conformant: 0,
          partiallyConformant: 0,
          nonConformant: 0,
          notApplicable: 0,
          notChecked: 0,
          unsupported: 0,
          inconclusive: 0,
          parseFailed: 0,
        },
        ts119602: {
          conformant: 0,
          partiallyConformant: 0,
          nonConformant: 0,
          notApplicable: 0,
          notChecked: 0,
          unsupported: 0,
          inconclusive: 0,
          parseFailed: 0,
        },
      },
      results: [],
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/report/markdown",
      payload: { report },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().markdown).toContain("# WE BUILD Trusted List Audit");
    await app.close();
  });

  it("returns stable 400 error for invalid body", async () => {
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/audit/url",
      payload: { options: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Invalid request body.",
      },
    });
    await app.close();
  });

  it("returns format-specific LoTL parse errors", async () => {
    const app = await buildServer();
    const malformedXml = await app.inject({
      method: "POST",
      url: "/api/v1/lotl/parse",
      payload: { lotl: "<TrustServiceStatusList>" },
    });
    const malformedJson = await app.inject({
      method: "POST",
      url: "/api/v1/audit/json",
      payload: { lotl: "{" },
    });
    const xmlOnJsonEndpoint = await app.inject({
      method: "POST",
      url: "/api/v1/audit/json",
      payload: { lotl: "<TrustServiceStatusList/>" },
    });

    expect(malformedXml.statusCode).toBe(400);
    expect(malformedXml.json()).toMatchObject({ error: { code: "invalid_lotl_xml" } });
    expect(malformedJson.statusCode).toBe(400);
    expect(malformedJson.json()).toMatchObject({ error: { code: "invalid_lotl_json" } });
    expect(xmlOnJsonEndpoint.statusCode).toBe(400);
    expect(xmlOnJsonEndpoint.json()).toMatchObject({ error: { code: "invalid_lotl_json" } });
    await app.close();
  });

  it("serves loadable OpenAPI specs with required paths", async () => {
    const app = await buildServer();
    const yamlResponse = await app.inject({
      method: "GET",
      url: "/openapi.yaml",
    });
    const jsonResponse = await app.inject({
      method: "GET",
      url: "/openapi.json",
    });
    expect(yamlResponse.statusCode).toBe(200);
    expect(jsonResponse.statusCode).toBe(200);
    const parsedYaml = YAML.parse(yamlResponse.body);
    const parsedJson = jsonResponse.json();
    for (const path of [
      "/",
      "/healthz",
      "/api/v1/audit/url",
      "/api/v1/audit/json",
      "/api/v1/lotl/parse",
      "/api/v1/artifact/assess-url",
      "/api/v1/report/markdown",
      "/api/audit/lotl",
      "/api/audit/artifact",
      "/api/audit/certificate-chain",
      "/api/audit/fixture-readiness",
      "/api/reports/markdown",
      "/docs",
    ]) {
      expect(parsedYaml.paths[path]).toBeDefined();
      expect(parsedJson.paths[path]).toBeDefined();
    }
    expect(parsedYaml.components.schemas.Ts119602ContextOptions).toEqual(
      parsedJson.components.schemas.Ts119602ContextOptions,
    );
    expect(
      parsedJson.components.schemas.Ts119612SignerEvidence.properties.revocation
        .required,
    ).toContain("signerFingerprintSha256");
    expect(
      parsedJson.components.schemas.Ts119602ContextOptions.properties
        .pointerSigners.items.$ref,
    ).toBe("#/components/schemas/TrustListPointerSignerEvidence");
    expect(
      parsedJson.components.schemas.AuditReport.properties.input.properties.kind.enum,
    ).toContain("xml");
    expect(
      parsedJson.components.schemas.ApiErrorResponse.properties.error.properties.code.enum,
    ).toEqual(expect.arrayContaining(["invalid_lotl", "invalid_lotl_json", "invalid_lotl_xml"]));
    expect(parsedJson.paths["/api/audit/lotl"].post.summary).toContain("XML");
    expect(
      parsedJson.paths["/api/v1/audit/url"].post.requestBody.content["application/json"].examples.euXml.value.url,
    ).toBe("https://ec.europa.eu/tools/lotl/eu-lotl.xml");
    expect(
      parsedJson.components.schemas.Ts119602ContextOptions.properties.ts119602
        .$ref,
    ).toBe("#/components/schemas/Ts119602ContextualEvidence");
    expect(
      parsedJson.components.schemas.Ts119602ResourceEvidence.required,
    ).toContain("sha256");
    expect(
      parsedJson.components.schemas.TrustListPointerSignerEvidence.required,
    ).toContain("location");
    expect(
      parsedJson.components.schemas.CertificateSummary.properties.source.enum,
    ).toContain("json_signature");
    expect(
      parsedJson.components.schemas.AuditReport.properties.schemaVersion.const,
    ).toBe(7);
    expect(
      parsedJson.components.schemas.TrustedListAuditResult.required,
    ).toContain("referenceProfiles");
    expect(
      parsedJson.components.schemas.TrustedListAuditResult.properties
        .ts119612Coverage.$ref,
    ).toBe("#/components/schemas/Ts119612CoverageAudit");
    expect(
      parsedJson.components.schemas.Ts119612CoverageAudit.required,
    ).toContain("completeVerdictEligible");
    expect(
      parsedJson.components.schemas.TrustedListAuditResult.properties
        .ts119602Coverage.$ref,
    ).toBe("#/components/schemas/Ts119602CoverageAudit");
    expect(
      parsedJson.components.schemas.Ts119602CoverageAudit.required,
    ).toContain("completeVerdictEligible");
    expect(
      parsedJson.components.schemas.Ts119602CoverageAudit.properties.selection
        .required,
    ).toContain("schemeMode");
    expect(
      parsedJson.components.schemas.Ts119612RequirementCoverage.properties
        .outcome.enum,
    ).toContain("not_implemented");
    expect(
      parsedJson.components.schemas.ReferenceProfileAssessment.required,
    ).toContain("checks");
    expect(parsedJson.info.description).toContain(
      "pinned V1.1.1 XSD and offline catalog",
    );
    expect(parsedJson.paths["/api/audit/artifact"].post.description).toContain(
      "separate pinned offline XML Schema finding",
    );
    const documentedExample =
      parsedJson.paths["/api/v1/report/markdown"].post.requestBody.content[
        "application/json"
      ].examples.emptyReport.value;
    const exampleResponse = await app.inject({
      method: "POST",
      url: "/api/v1/report/markdown",
      payload: documentedExample,
    });
    expect(exampleResponse.statusCode).toBe(200);
    expect(exampleResponse.json().markdown).toContain("Report schema: v7");
    await app.close();
  });

  it("uses request origin in served OpenAPI specs", async () => {
    const app = await buildServer();
    const headers = { host: "127.0.0.1:8088" };
    const yamlResponse = await app.inject({
      method: "GET",
      url: "/openapi.yaml",
      headers,
    });
    const jsonResponse = await app.inject({
      method: "GET",
      url: "/openapi.json",
      headers,
    });
    expect(YAML.parse(yamlResponse.body).servers[0].url).toBe(
      "http://127.0.0.1:8088",
    );
    expect(jsonResponse.json().servers[0].url).toBe("http://127.0.0.1:8088");
    await app.close();
  });

  it("uses PUBLIC_BASE_URL ahead of request origin", async () => {
    process.env.PUBLIC_BASE_URL = "https://audit.example.test/";
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/openapi.json",
      headers: { host: "127.0.0.1:8088" },
    });
    expect(response.json().servers[0].url).toBe("https://audit.example.test");
    await app.close();
  });

  it("uses env audit defaults when request options are omitted", async () => {
    process.env.AUDIT_FETCH = "false";
    process.env.AUDIT_CONCURRENCY = "2";
    process.env.AUDIT_TIMEOUT_MS = "500";
    const app = await buildServer();
    const lotl = JSON.parse(await readFile("test/fixtures/lotl.json", "utf8"));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/audit/json",
      payload: { lotl },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().report.summary).toMatchObject({
      fetched: 0,
      fetchFailed: 0,
      unknownArtifacts: 3,
    });
    await app.close();
  });

  it("serves Stoplight Elements docs HTML", async () => {
    const app = await buildServer();
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("@stoplight/elements@9.0.0");
    expect(response.body).toContain("/openapi.yaml");
    expect(response.body).toContain('href="/favicon.svg"');
    await app.close();
  });

  it("serves the local audit interface and its assets", async () => {
    const app = await buildServer();
    const [page, css, script, favicon, sharedCss, negativeLogo] =
      await Promise.all([
        app.inject({ method: "GET", url: "/" }),
        app.inject({ method: "GET", url: "/assets/audit-ui.css" }),
        app.inject({ method: "GET", url: "/assets/audit-ui.js" }),
        app.inject({ method: "GET", url: "/assets/credimi_logo.svg" }),
        app.inject({ method: "GET", url: "/assets/style.css" }),
        app.inject({ method: "GET", url: "/assets/credimi_logo_negative.svg" }),
      ]);
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain('id="lotl-url"');
    expect(page.body).toContain("ETSI TS 119 612 XML LoTL");
    expect(page.body).toContain("Upload LoTL XML or JSON file");
    expect(page.body).toContain('accept="application/xml,text/xml,application/json,.xml,.json"');
    expect(page.body).toContain("Advanced options");
    expect(page.body).toContain("/assets/audit-ui.js");
    expect(page.body).toContain('rel="icon" href="/favicon.svg"');
    expect(page.body).toContain('href="/assets/style.css"');
    expect(page.body).toContain("eudi-trust-inspector");
    expect(page.body).toContain('class="brand-lockup" href="/"');
    expect(page.body).toContain(
      '<span class="brand-name">EUDI Trust Inspector</span>',
    );
    expect(page.body).toContain('class="hero-band"');
    expect(page.body).not.toContain('class="summary-panel"');
    expect(page.body).not.toContain("<style>");
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toContain("--audit-max-width");
    expect(css.body).toContain(".hero-band");
    expect(script.headers["content-type"]).toContain("application/javascript");
    expect(script.body).toContain("/api/audit/lotl");
    expect(script.body).toContain("choose an XML or JSON file");
    expect(script.body).toContain("/api/audit/artifact");
    expect(script.body).toContain("Fixture readiness");
    expect(script.body).toContain("FCAF trusted authorities");
    expect(script.body).toContain("Negative fixture descriptors");
    expect(script.body).toContain("Fetched TrustedList:");
    expect(css.body).toContain(".result-group");
    expect(css.body).not.toMatch(/\.result-panel\s*\{\s*max-height:/);
    expect(css.body).toMatch(
      /#json-result,\s*#markdown-result\s*\{\s*max-height:\s*680px;/,
    );
    expect(favicon.headers["content-type"]).toContain("image/svg+xml");
    expect(favicon.body).toContain("<svg");
    expect(sharedCss.headers["content-type"]).toContain("text/css");
    expect(negativeLogo.headers["content-type"]).toContain("image/svg+xml");
    expect(() => new Function(script.body)).not.toThrow();
    await app.close();
  });
});

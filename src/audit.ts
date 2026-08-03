import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "./certs.js";
import { detectArtifact } from "./detect.js";
import { fetchArtifact, saveFetchedArtifact } from "./fetcher.js";
import { isUrl, loadInput } from "./input.js";
import { assessJsonLote } from "./json/loteChecks.js";
import { parseLotl, parseLotlJson } from "./lotl.js";
import type { LotlFormat } from "./lotl.js";
import { assessWeBuildProfile } from "./profiles/weBuild.js";
import { assessTs119612ReferenceProfiles, emptyReferenceProfiles } from "./profiles/ts119612ReferenceProfiles.js";
import { assessFixtureReadiness } from "./eudi/fixtureReadiness.js";
import { assessFcafTrustedAuthorities } from "./fcaf/trustedAuthorities.js";
import { generateNegativeFixtureDescriptors, writeNegativeFixtureDescriptors } from "./fixtures/negativeDescriptors.js";
import { buildStandardAssessment } from "./standards/assessment.js";
import { assessTs119602AlternativeXml } from "./standards/ts119602AlternativeXml.js";
import { classifyTs119602Artifact, createUnknownTs119602Classification } from "./standards/ts119602Classification.js";
import { assessTs119602Context } from "./standards/ts119602Context.js";
import { auditTs119602Coverage, inferTs119602CoverageSchemeMode, ts119602CoverageFinding } from "./standards/ts119602Coverage.js";
import { assessTs119612Context } from "./standards/ts119612Context.js";
import { auditTs119612Coverage, ts119612CoverageFinding } from "./standards/ts119612Coverage.js";
import { buildAuditReport } from "./report/jsonReport.js";
import { renderMarkdownReport } from "./report/markdownReport.js";
import type { ArtifactKind, AuditReport, CheckResult, CliOptions, PointerInfo, StandardApplicability, TrustedListAuditResult, TrustListContextOptions } from "./types.js";
import { assessTs119612Xml } from "./xml/ts119612Checks.js";
import { assessXmlLoteMetadata } from "./xml/loteMetadata.js";

export interface AuditCoreOptions {
  concurrency: number;
  timeoutMs: number;
  xsd?: string;
  strict: boolean;
  includeJsonLoteChecks: boolean;
  fetch: boolean;
  rpacChain?: string | string[];
  context?: TrustListContextOptions;
}

export interface InMemoryAuditOptions extends AuditCoreOptions {
  source: string;
  kind: "file" | "url" | LotlFormat;
  lotlText: string;
  sha256?: string;
}

export interface AuditInMemoryResult {
  json: AuditReport;
  markdown: string;
}

export interface AssessArtifactUrlOptions {
  url: string;
  declared?: Partial<TrustedListAuditResult["declared"]>;
  timeoutMs: number;
  strict: boolean;
  includeJsonLoteChecks: boolean;
  xsd?: string;
  context?: TrustListContextOptions;
}

export interface AssessArtifactContentOptions {
  content: string;
  source?: string;
  contentType?: string;
  declared?: Partial<TrustedListAuditResult["declared"]>;
  strict: boolean;
  includeJsonLoteChecks: boolean;
  xsd?: string;
  context?: TrustListContextOptions;
  timeoutMs?: number;
}

export async function runAudit(options: CliOptions, version: string): Promise<AuditReport> {
  const input = await loadInput(options.input, options.timeoutMs);
  const rpacChain = options.rpacChain ? await loadRpacChain(options.rpacChain) : undefined;
  const priorArtifact = options.priorLote ? {
    content: await readFile(options.priorLote, "utf8"),
    source: options.priorLote,
  } : undefined;
  const result = await runAuditInMemory(
    {
      source: options.input,
      kind: input.kind,
      lotlText: input.text,
      sha256: input.sha256,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      xsd: options.xsd,
      strict: options.strict,
      includeJsonLoteChecks: options.includeJsonLoteChecks,
      fetch: options.fetch,
      rpacChain,
      context: options.contextual || priorArtifact ? {
        dereference: options.contextual,
        priorArtifacts: priorArtifact ? [priorArtifact] : undefined,
      } : undefined,
    },
    version,
  );

  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "report.json"), `${JSON.stringify(result.json, null, 2)}\n`);
  await writeFile(join(options.outDir, "report.md"), result.markdown);
  if (options.generateNegativeFixtures) {
    await writeNegativeFixtureDescriptors(result.json.negativeFixtureDescriptors);
  }

  if (options.fetch) {
    await persistFetchedArtifacts(result.json.results, options);
  }

  return result.json;
}

export async function runAuditInMemory(options: InMemoryAuditOptions, version: string): Promise<AuditInMemoryResult> {
  const parsedLotl = parseLotl(options.lotlText);
  const generatedAt = new Date().toISOString();

  const results = await mapConcurrent(parsedLotl.pointers, options.concurrency, (pointer) => auditPointer(pointer, options));
  const weBuildProfile = assessWeBuildProfile(parsedLotl, results);
  const fixtureReadiness = assessFixtureReadiness({
    source: options.source,
    lotl: parsedLotl,
    results,
    weBuildRoleCounts: weBuildProfile.roleCounts,
    weBuildPointerConsistency: weBuildProfile.pointerConsistency,
    rpacChain: options.rpacChain,
  });
  const fcafTrustedAuthorities = assessFcafTrustedAuthorities({
    pointerCount: parsedLotl.summary.pointerCount,
    results,
    pointerCertificatesParsed: weBuildProfile.pointerConsistency.pointerCertificatesParsed,
    accessCaOrWrpacProviderCount: weBuildProfile.roleCounts.wrpac_provider ?? 0,
    fixtureReadiness,
  });
  const negativeFixtureDescriptors = generateNegativeFixtureDescriptors({
    results,
    fcafTrustedAuthorities,
    fixtureReadiness,
    pointerCertificatesParsed: weBuildProfile.pointerConsistency.pointerCertificatesParsed,
    accessCaOrWrpacProviderCount: weBuildProfile.roleCounts.wrpac_provider ?? 0,
    listTypeCounts: weBuildProfile.listTypeCounts,
  });

  const report = buildAuditReport({
    generatedAt,
    input: {
      source: options.source,
      kind: options.kind,
      sha256: options.sha256 ?? sha256Hex(Buffer.from(options.lotlText, "utf8")),
    },
    lotl: parsedLotl.summary,
    weBuildProfile,
    fixtureReadiness,
    fcafTrustedAuthorities,
    negativeFixtureDescriptors,
    results,
    version,
  });

  return {
    json: report,
    markdown: renderMarkdownReport(report),
  };
}

async function loadRpacChain(path: string): Promise<string | string[]> {
  const text = (await readFile(path, "utf8")).trim();
  if (!text) throw new Error("RPAC chain file is empty.");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) return parsed;
    if (typeof parsed === "object" && parsed !== null && "x5c" in parsed) {
      const x5c = (parsed as { x5c?: unknown }).x5c;
      if (Array.isArray(x5c) && x5c.every((item): item is string => typeof item === "string")) return x5c;
    }
  } catch {
    // PEM and base64 chain files are accepted as raw text.
  }
  return text;
}

export async function runAuditFromUrl(url: string, options: AuditCoreOptions, version: string): Promise<AuditInMemoryResult> {
  if (!isUrl(url)) {
    throw new Error("Invalid URL input.");
  }
  const input = await loadInput(url, options.timeoutMs);
  return runAuditInMemory(
    {
      ...options,
      source: url,
      kind: "url",
      lotlText: input.text,
      sha256: input.sha256,
    },
    version,
  );
}

export async function runAuditFromJson(lotl: unknown, options: AuditCoreOptions, version: string): Promise<AuditInMemoryResult> {
  const lotlText = typeof lotl === "string" ? lotl : JSON.stringify(lotl);
  parseLotlJson(lotlText);
  return runAuditInMemory(
    {
      ...options,
      source: "request-body",
      kind: "json",
      lotlText,
      sha256: sha256Hex(Buffer.from(lotlText, "utf8")),
    },
    version,
  );
}

export async function runAuditFromContent(content: string, options: AuditCoreOptions, version: string): Promise<AuditInMemoryResult> {
  const parsedLotl = parseLotl(content);
  return runAuditInMemory(
    {
      ...options,
      source: "request-body",
      kind: parsedLotl.format,
      lotlText: content,
      sha256: sha256Hex(Buffer.from(content, "utf8")),
    },
    version,
  );
}

export async function assessArtifactUrl(
  options: AssessArtifactUrlOptions,
): Promise<TrustedListAuditResult> {
  if (!isUrl(options.url)) {
    throw new Error("Invalid URL input.");
  }
  return auditPointer(
    {
      index: 1,
      location: options.url,
      declared: normalizeDeclared(options.declared),
      raw: undefined,
    },
    {
      concurrency: 1,
      timeoutMs: options.timeoutMs,
      strict: options.strict,
      includeJsonLoteChecks: options.includeJsonLoteChecks,
      fetch: true,
      xsd: options.xsd,
      context: options.context,
    },
  );
}

/** Assess supplied XML or JSON directly without a network request. */
export async function assessArtifactContent(options: AssessArtifactContentOptions): Promise<TrustedListAuditResult> {
  const bytes = Buffer.from(options.content, "utf8");
  const source = options.source ?? "request-body";
  const base: TrustedListAuditResult = {
    id: resultId({ index: 1, location: source, declared: normalizeDeclared(options.declared), raw: undefined }),
    index: 1,
    source,
    location: source,
    declared: normalizeDeclared(options.declared),
    fetch: { attempted: false, ok: true, contentType: options.contentType, bytes: bytes.length, sha256: sha256Hex(bytes) },
    detected: { format: "unknown", artifactKind: "unknown" },
    ts119602Classification: createUnknownTs119602Classification(options.declared?.loteType),
    standardApplicability: unknownApplicability(),
    referenceProfiles: emptyReferenceProfiles(),
    ts119612: { applicable: false, conformanceLevel: "not_checked", score: null, checks: [check("input.raw_artifact", "parse", "pass", "info", "Raw artifact content was supplied directly; no network request was made.")], mandatoryFailures: [], warnings: [] },
    ts119602: unassessedStandard(),
  };
  return assessArtifactBytes(base, bytes, options.contentType, options);
}

async function auditPointer(pointer: PointerInfo, options: AuditCoreOptions): Promise<TrustedListAuditResult> {
  const base: TrustedListAuditResult = {
    id: resultId(pointer),
    index: pointer.index,
    source: pointer.location,
    location: pointer.location,
    declared: pointer.declared,
    fetch: {
      attempted: false,
      ok: false,
    },
    detected: {
      format: "unknown",
      artifactKind: "unknown",
    },
    ts119602Classification: createUnknownTs119602Classification(pointer.declared.loteType),
    standardApplicability: unknownApplicability(),
    referenceProfiles: emptyReferenceProfiles(),
    ts119612: {
      applicable: false,
      conformanceLevel: "not_checked",
      score: null,
      checks: [],
      mandatoryFailures: [],
      warnings: [],
    },
    ts119602: unassessedStandard(),
  };

  if (!options.fetch) {
    base.ts119612.checks.push(check("fetch.not_attempted", "fetch", "not_checked", "warning", "Fetch disabled by --no-fetch; referenced location was not assessed."));
    base.ts119612.warnings.push("fetch.not_attempted: Fetch disabled by --no-fetch; referenced location was not assessed.");
    return base;
  }

  const fetched = await fetchArtifact(pointer.location, options.timeoutMs);
  base.fetch = fetched.fetch;
  base.ts119612.checks.push(
    check("fetch.attempted", "fetch", "pass", "info", "Fetch attempted."),
    check("fetch.http_ok", "fetch", fetched.fetch.ok ? "pass" : "fail", fetched.fetch.ok ? "info" : "critical", "HTTP fetch returned a 2xx response.", fetched.fetch.status),
    check("fetch.non_empty", "fetch", fetched.bytes && fetched.bytes.length > 0 ? "pass" : "fail", fetched.bytes && fetched.bytes.length > 0 ? "info" : "critical", "Fetched content is non-empty.", fetched.fetch.bytes),
  );

  if (!fetched.fetch.ok || !fetched.bytes) {
    base.ts119612.conformanceLevel = "fetch_failed";
    base.ts119612.mandatoryFailures = base.ts119612.checks
      .filter((c) => c.status === "fail")
      .map((c) => `${c.id}: ${c.message}`);
    return base;
  }

  return assessArtifactBytes(base, fetched.bytes, fetched.fetch.contentType, options);
}

async function assessArtifactBytes(
  base: TrustedListAuditResult,
  bytes: Buffer,
  contentType: string | undefined,
  options: Pick<AuditCoreOptions, "strict" | "includeJsonLoteChecks" | "xsd" | "context"> & { timeoutMs?: number },
): Promise<TrustedListAuditResult> {
  const detected = detectArtifact(bytes, contentType);
  base.detected = {
    format: detected.format,
    artifactKind: detected.artifactKind,
  };
  base.ts119602Classification = classifyTs119602Artifact({
    bytes,
    detection: detected,
    declaredType: base.declared.loteType,
  });
  base.standardApplicability = applicabilityFor(detected.artifactKind, base.ts119602Classification.applicability);
  routeStandardChecks(base);

  if (detected.artifactKind === "ts119612_xml_tsl" || detected.artifactKind === "ts119612_xml_lotl") {
    const assessed = await assessTs119612Xml(bytes.toString("utf8"), {
      strict: options.strict,
      xsdPath: options.xsd,
      trustedSignerFingerprintsSha256: options.context?.trustedSignerFingerprintsSha256,
      signerEvidence: options.context?.ts119612Signer,
    });
    const result = mergeResult(base, assessed);
    applyTs119612ReferenceProfiles(result, bytes.toString("utf8"));
    if (base.ts119602Classification.applicability === "applicable") {
      const alternative = assessTs119602AlternativeXml(
        assessed.ts119612Facts,
        result.ts119612.checks,
        base.ts119602Classification.profileStatus,
      );
      result.ts119602 = buildStandardAssessment([
        ...result.ts119602.checks,
        ...alternative.checks,
      ], { coverageComplete: false });
      result.extracted = {
        ...result.extracted,
        jsonLote: {
          assessmentProfile: "ETSI TS 119 602 Annex A.2.2 alternative XML binding",
          XmlBinding: "ts119612_alternative_xml",
          LoTEVersionIdentifier: assessed.ts119612Facts?.metadata.version,
          LoTESequenceNumber: assessed.ts119612Facts?.metadata.sequence,
          LoTEType: assessed.ts119612Facts?.metadata.loteType,
          TrustedEntityCount: alternative.entityCount,
          ServiceCount: alternative.serviceCount,
          TableA1Mapped: alternative.mapped,
        },
      };
    }
    return finalizeTs119602Coverage(await applyTs119612Context(result, bytes, contentType, options));
  }

  if (detected.artifactKind === "xml_lote") {
    const result = mergeResult(base, await assessXmlLoteMetadata(
      bytes.toString("utf8"),
      new Date(),
      base.ts119602Classification.profileStatus,
      options.context?.trustedSignerFingerprintsSha256,
    ));
    return applyContext(result, bytes, contentType, options);
  }

  if (detected.artifactKind === "json_lote" || detected.artifactKind === "json_lotl") {
    const assessed = assessJsonLote(detected.parsedJson, options.includeJsonLoteChecks, new Date(), {
      compactJades: detected.compactJades,
      profileSelectionStatus: base.ts119602Classification.profileStatus,
      trustedSignerFingerprintsSha256: options.context?.trustedSignerFingerprintsSha256,
    });
    return applyContext(mergeResult(base, assessed), bytes, contentType, options);
  }

  const reason =
    detected.format === "html"
      ? "Fetched artifact appears to be HTML/error page, not TS 119 612 XML."
      : "Fetched artifact is not a recognized JSON LoTE/LoTL or ETSI TS 119 612 XML artifact.";
  base.ts119612 = {
    applicable: false,
    conformanceLevel: "not_applicable",
    score: null,
    checks: [
      ...base.ts119612.checks,
      check("profile.ts119612_applicability", "profile", "not_applicable", "info", reason, detected),
    ],
    mandatoryFailures: [],
    warnings: [],
  };
  return base;
}

async function applyContext(
  result: TrustedListAuditResult,
  bytes: Buffer,
  contentType: string | undefined,
  options: Pick<AuditCoreOptions, "context"> & { timeoutMs?: number },
): Promise<TrustedListAuditResult> {
  if (options.context && result.ts119602.applicable) {
    const contextual = await assessTs119602Context({
      currentBytes: bytes,
      currentContentType: contentType,
      currentResult: result,
      timeoutMs: options.timeoutMs ?? 15_000,
      options: options.context,
    });
    const replacementIds = new Set(contextual.map((entry) => entry.id));
    result.ts119602 = buildStandardAssessment([
      ...result.ts119602.checks.filter((entry) => !replacementIds.has(entry.id)),
      ...contextual,
    ], { coverageComplete: false });
  }
  return finalizeTs119602Coverage(result);
}

function finalizeTs119602Coverage(result: TrustedListAuditResult): TrustedListAuditResult {
  if (!result.ts119602.applicable || result.ts119602Classification.applicability !== "applicable") return result;
  const checks = result.ts119602.checks.filter((entry) => entry.id !== "ts119602.coverage.complete");
  const coverage = auditTs119602Coverage({
    classification: result.ts119602Classification,
    schemeMode: inferTs119602CoverageSchemeMode(checks),
  }, checks);
  checks.push(ts119602CoverageFinding(coverage));
  result.ts119602Coverage = coverage;
  result.ts119602 = buildStandardAssessment(checks, { coverageComplete: coverage.completeVerdictEligible });
  return result;
}

async function applyTs119612Context(
  result: TrustedListAuditResult,
  bytes: Buffer,
  contentType: string | undefined,
  options: Pick<AuditCoreOptions, "context"> & { timeoutMs?: number },
): Promise<TrustedListAuditResult> {
  if (!options.context || !result.ts119612.applicable) return result;
  const contextual = await assessTs119612Context({
    currentBytes: bytes,
    currentContentType: contentType,
    currentResult: result,
    timeoutMs: options.timeoutMs ?? 15_000,
    options: options.context,
  });
  const replacementIds = new Set([
    "ts119612.coverage.complete",
    ...contextual.map((entry) => entry.id),
  ]);
  const checks = [
    ...result.ts119612.checks.filter((entry) => !replacementIds.has(entry.id)),
    ...contextual,
  ];
  const coverage = auditTs119612Coverage(result.detected.artifactKind, checks);
  checks.push(ts119612CoverageFinding(coverage));
  result.ts119612Coverage = coverage;
  result.ts119612 = buildStandardAssessment(checks, { coverageComplete: coverage.completeVerdictEligible });
  return result;
}

function applyTs119612ReferenceProfiles(result: TrustedListAuditResult, xml: string): void {
  if (result.detected.artifactKind !== "ts119612_xml_tsl" && result.detected.artifactKind !== "ts119612_xml_lotl") return;
  result.referenceProfiles = assessTs119612ReferenceProfiles({
    xml,
    source: result.source,
    artifactKind: result.detected.artifactKind,
  });
  result.standardApplicability.weBuildProfile = result.referenceProfiles.weBuildTs119612.applicability;
  const observedRoles = new Set([
    ...result.referenceProfiles.eudiRiTs119612.observedRoles,
    ...result.referenceProfiles.weBuildTs119612.observedRoles,
  ]);
  result.standardApplicability.eudiTrustRole = observedRoles.size > 0
    ? "applicable"
    : "not_applicable";
}

function routeStandardChecks(result: TrustedListAuditResult): void {
  const transportChecks = result.ts119612.checks;
  if (["xml_lote", "json_lote", "json_lotl"].includes(result.detected.artifactKind)) {
    result.ts119602 = buildStandardAssessment([
      ...transportChecks,
      ...ts119602ClassificationChecks(result),
    ], { coverageComplete: false });
    result.ts119612 = buildStandardAssessment([
      check(
        "profile.ts119612_applicability",
        "profile",
        "not_applicable",
        "info",
        "Artifact uses a JSON or scheme-explicit XML LoTE binding, not the ETSI TS 119 612 XML Trusted List binding.",
      ),
    ], { applicable: false });
    return;
  }
  if (["ts119612_xml_tsl", "ts119612_xml_lotl"].includes(result.detected.artifactKind)) {
    if (result.ts119602Classification.applicability === "applicable") {
      result.ts119602 = buildStandardAssessment([
        ...ts119602ClassificationChecks(result),
      ], { coverageComplete: false });
      return;
    }
    if (result.ts119602Classification.applicability === "unknown") {
      const checks = ts119602ClassificationChecks(result);
      result.ts119602 = {
        applicable: false,
        conformanceLevel: "inconclusive",
        score: null,
        checks,
        mandatoryFailures: [],
        warnings: checks.map((entry) => `${entry.id}: ${entry.message}`),
      };
      return;
    }
    result.ts119602 = buildStandardAssessment([
      check(
        "profile.ts119602_applicability",
        "profile",
        "not_applicable",
        "info",
        "Embedded profile evidence has not selected this TS 119 612 artifact as a TS 119 602 alternative-binding LoTE.",
        result.ts119602Classification,
      ),
    ], { applicable: false });
  }
}

function ts119602ClassificationChecks(result: TrustedListAuditResult): CheckResult[] {
  const classification = result.ts119602Classification;
  const bindingStatus = classification.bindingStatus === "selected"
    ? "pass"
    : classification.bindingStatus === "unsupported"
      ? "fail"
      : classification.bindingStatus === "candidate"
        ? "not_checked"
        : "not_applicable";
  const profileStatus = classification.profileStatus === "selected"
    ? "pass"
    : classification.profileStatus === "conflict"
      ? "inconclusive"
      : "not_checked";
  return [
    check(
      "ts119602.binding.supported",
      "profile",
      bindingStatus,
      bindingStatus === "fail" ? "critical" : bindingStatus === "pass" ? "info" : "warning",
      bindingStatus === "pass"
        ? `Selected TS 119 602 binding: ${classification.binding}.`
        : classification.reasons[0],
      classification,
    ),
    check(
      "ts119602.profile.selection",
      "profile",
      profileStatus,
      profileStatus === "inconclusive" ? "error" : profileStatus === "pass" ? "info" : "warning",
      profileStatus === "pass"
        ? `Selected TS 119 602 profile: ${classification.profile}.`
        : classification.reasons.at(-1) ?? "No TS 119 602 profile was selected.",
      classification.evidence,
    ),
  ];
}

function resultId(pointer: PointerInfo): string {
  return `artifact-${String(pointer.index).padStart(3, "0")}-${sha256Hex(pointer.location).slice(0, 12)}`;
}

function unknownApplicability(): StandardApplicability {
  return {
    ts119612: "unknown",
    ts119602: "unknown",
    weBuildProfile: "unknown",
    eudiTrustRole: "unknown",
  };
}

function applicabilityFor(artifactKind: ArtifactKind, ts119602: StandardApplicability["ts119602"]): StandardApplicability {
  if (artifactKind === "ts119612_xml_tsl" || artifactKind === "ts119612_xml_lotl") {
    return {
      ts119612: "applicable",
      ts119602,
      weBuildProfile: "unknown",
      eudiTrustRole: "unknown",
    };
  }
  if (artifactKind === "xml_lote" || artifactKind === "json_lote" || artifactKind === "json_lotl") {
    return {
      ts119612: "not_applicable",
      ts119602,
      weBuildProfile: "applicable",
      eudiTrustRole: "unknown",
    };
  }
  return unknownApplicability();
}

async function persistFetchedArtifacts(results: TrustedListAuditResult[], options: CliOptions): Promise<void> {
  await mapConcurrent(results, options.concurrency, async (result) => {
    if (!result.fetch.ok || !result.fetch.finalUrl) return;
    const fetched = await fetchArtifact(result.location, options.timeoutMs);
    if (!fetched.bytes) return;
    await saveFetchedArtifact(options.outDir, result.index, result.location, fetched.bytes, result.detected.format);
  });
}

function normalizeDeclared(declared?: Partial<TrustedListAuditResult["declared"]>): TrustedListAuditResult["declared"] {
  return {
    mimeType: declared?.mimeType,
    loteType: declared?.loteType,
    schemeOperatorName: declared?.schemeOperatorName,
    schemeTerritory: declared?.schemeTerritory,
    pointerCertificateFingerprintsSha256: declared?.pointerCertificateFingerprintsSha256 ?? [],
  };
}

function mergeResult(
  base: TrustedListAuditResult,
  assessed: Partial<Pick<TrustedListAuditResult, "ts119612" | "ts119612Coverage" | "ts119602" | "ts119602Coverage" | "extracted" | "detected">>,
): TrustedListAuditResult {
  return {
    ...base,
    detected: assessed.detected ?? base.detected,
    ts119612: mergeStandardAssessment(base.ts119612, assessed.ts119612),
    ts119612Coverage: assessed.ts119612Coverage ?? base.ts119612Coverage,
    ts119602: mergeStandardAssessment(base.ts119602, assessed.ts119602),
    ts119602Coverage: assessed.ts119602Coverage ?? base.ts119602Coverage,
    extracted: assessed.extracted,
  };
}

function mergeStandardAssessment(
  base: TrustedListAuditResult["ts119612"],
  assessed: TrustedListAuditResult["ts119612"] | undefined,
): TrustedListAuditResult["ts119612"] {
  if (!assessed) return base;
  const checks = [...base.checks, ...assessed.checks];
  const mandatoryFailures = checks
    .filter((entry) => entry.status === "fail" && (entry.severity === "critical" || entry.severity === "error"))
    .map((entry) => `${entry.id}: ${entry.message}`);
  const warnings = checks
    .filter((entry) => ["warn", "not_checked", "unsupported", "inconclusive"].includes(entry.status))
    .map((entry) => `${entry.id}: ${entry.message}`);
  const conformanceLevel = assessed.conformanceLevel === "parse_failed" || assessed.conformanceLevel === "fetch_failed"
    ? assessed.conformanceLevel
    : mandatoryFailures.length > 0
      ? "non_conformant"
      : assessed.conformanceLevel;
  return {
    ...assessed,
    conformanceLevel,
    checks,
    mandatoryFailures,
    warnings,
  };
}

function unassessedStandard(): TrustedListAuditResult["ts119602"] {
  return {
    applicable: false,
    conformanceLevel: "not_checked",
    score: null,
    checks: [],
    mandatoryFailures: [],
    warnings: [],
  };
}

function check(
  id: string,
  category: CheckResult["category"],
  status: CheckResult["status"],
  severity: CheckResult["severity"],
  message: string,
  evidence?: unknown,
): CheckResult {
  return { id, category, status, severity, message, evidence };
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

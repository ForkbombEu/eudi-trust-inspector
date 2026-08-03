import type { CertificateSummary, CheckResult, ConformanceLevel, TrustedListAuditResult, Ts119612SignerEvidence } from "../types.js";
import {
  TS119612_COMPATIBILITY_INPUTS,
  TS119612_SOURCE,
} from "../standards/ts119612Requirements.js";
import { auditTs119612Coverage, ts119612CoverageFinding } from "../standards/ts119612Coverage.js";
import { validateTs119602UtcDateTime } from "../standards/ts119602Syntax.js";
import { parseXml } from "./parse.js";
import { assessSignature } from "./signature.js";
import { assessTs119612SchemeInformation } from "./ts119612SchemeInformation.js";
import { extractTs119612ValidatedFacts, type Ts119612ValidatedFacts } from "./ts119612Facts.js";
import { assessTs119612ServiceSemantics } from "./ts119612ServiceSemantics.js";
import { assessTs119612Pointers } from "./ts119612Pointers.js";
import { assessTs119612TspServices } from "./ts119612TspServices.js";
import { validateTs119612XmlSchema } from "./ts119612Xsd.js";
import type { XsdValidationDependencies } from "./xsd.js";
import { D, L, has, nodes, text, texts } from "./xpath.js";

export interface XmlAssessmentOptions {
  strict: boolean;
  xsdPath?: string;
  xsdDependencies?: XsdValidationDependencies;
  assessmentDate?: Date;
  trustedSignerFingerprintsSha256?: readonly string[];
  signerEvidence?: Ts119612SignerEvidence;
}

type ExtractedMetadata = NonNullable<TrustedListAuditResult["extracted"]>;

const CANONICAL_ETSI_NS = "http://uri.etsi.org/02231/v2#";
const EUDI_RI_ETSI_NS_VARIANT = "http://uri.etsi.org/19612/v2.4.1#";
const EU_APPROPRIATE = "http://uri.etsi.org/TrstSvc/TrustedList/StatusDetn/EUappropriate";
const PUB_EAA_LOTE_TYPE = "http://uri.etsi.org/19602/LoTEType/EUPubEAAProvidersList";

export interface Ts119612XmlAssessment extends Pick<TrustedListAuditResult, "ts119612" | "ts119612Coverage" | "extracted" | "detected"> {
  ts119612Facts?: Ts119612ValidatedFacts;
}

export async function assessTs119612Xml(
  xml: string,
  options: XmlAssessmentOptions,
): Promise<Ts119612XmlAssessment> {
  const assessmentDate = options.assessmentDate ?? new Date();
  const checks: CheckResult[] = [];
  const certificates: CertificateSummary[] = [];
  const parsed = parseXml(xml);
  if (!parsed.document || parsed.errors.some((e) => e.startsWith("fatal"))) {
    return {
      detected: { format: "xml", artifactKind: "unknown" },
      ts119612: {
        applicable: true,
        conformanceLevel: "parse_failed",
        score: 0,
        checks: [
          {
            id: "parse.xml",
            category: "parse",
            status: "fail",
            severity: "critical",
            message: "XML parse failed.",
            evidence: parsed.errors,
          },
        ],
        mandatoryFailures: ["XML parse failed."],
        warnings: [],
      },
    };
  }

  const document = parsed.document;
  const root = document.documentElement;
  const rootLocalName = root.localName || root.nodeName;
  const rootNs = root.namespaceURI ?? undefined;
  push(checks, "parse.xml", "parse", parsed.errors.length === 0 ? "pass" : "warn", parsed.errors.length === 0 ? "info" : "warning", parsed.errors.length === 0 ? "XML parsed successfully." : "XML parsed with parser warnings.", parsed.errors.length ? parsed.errors : undefined);
  push(checks, "parse.root_name", "parse", rootLocalName === "TrustServiceStatusList" ? "pass" : "fail", "critical", "Root element local name is TrustServiceStatusList.", rootLocalName);
  const namespaceStatus = rootNs === CANONICAL_ETSI_NS ? "pass" : rootNs === EUDI_RI_ETSI_NS_VARIANT ? "warn" : "fail";
  push(
    checks,
    "parse.root_namespace",
    "parse",
    namespaceStatus,
    namespaceStatus === "pass" ? "info" : namespaceStatus === "warn" ? "warning" : "error",
    namespaceStatus === "pass"
      ? "Root namespace matches the canonical ETSI TS 119 612 namespace."
      : namespaceStatus === "warn"
        ? "Root namespace is the observed EUDI RI/profile TS 119 612 variant; use an XSD whose target namespace matches this artifact."
        : "Root namespace does not identify a supported ETSI TS 119 612 namespace.",
    rootNs,
  );
  push(checks, "parse.root_id", "parse", root.hasAttribute("Id") ? "pass" : "fail", "error", "Root TrustServiceStatusList has Id attribute.", root.getAttribute("Id") ?? undefined);
  if (rootLocalName !== "TrustServiceStatusList" || !isTs119612Namespace(rootNs)) {
    return {
      detected: { format: "xml", artifactKind: rootLocalName === "TrustServiceStatusList" ? "xml_lotl_like" : "unknown" },
      ts119612: {
        applicable: false,
        conformanceLevel: "not_applicable",
        score: null,
        checks: [...checks, {
            id: "profile.ts119612_applicability",
            category: "profile",
            status: "not_applicable",
            severity: "info",
            message: "XML root element and namespace do not identify an ETSI TS 119 612 TrustServiceStatusList artifact.",
            evidence: { rootLocalName, rootNamespace: rootNs },
          }],
        mandatoryFailures: [],
        warnings: [],
      },
    };
  }
  const artifactKind = isLotlTslType(text(document, D("TSLType"))) ? "ts119612_xml_lotl" : "ts119612_xml_tsl";
  const extracted = extractMetadata(document);

  push(checks, "parse.schema_location", "parse", hasSchemaLocation(root) ? "pass" : "warn", "warning", "xsi:schemaLocation is present.", schemaLocation(root));

  const pubEaaAlternativeBinding = text(document, D("TSLType")) === PUB_EAA_LOTE_TYPE;
  const signature = await assessSignature(xml, document, assessmentDate, {}, {
    requireListCertificateMatch: isLotlOrLoteType(text(document, D("TSLType"))),
    requireBaselineB: true,
    requireAnnexH4: pubEaaAlternativeBinding,
    requireTs119612Profile: true,
    schemeTerritory: text(document, D("SchemeTerritory")),
    schemeOperatorNames: texts(document, `${D("SchemeOperatorName")}/${L("Name")}`),
    trustedSignerFingerprintsSha256: options.trustedSignerFingerprintsSha256,
    ts119612SignerEvidence: options.signerEvidence,
  });
  checks.push(...signature.checks);
  certificates.push(...signature.certificates);
  checks.push(await validateTs119612XmlSchema(xml, {
    namespace: rootNs,
    tslVersionIdentifier: extracted.tslVersionIdentifier,
    xsdOverridePath: options.xsdPath,
  }, options.xsdDependencies));

  const scheme = text(document, `/*[local-name()='TrustServiceStatusList']/${L("SchemeInformation")}`);
  push(checks, "structure.scheme_information", "structure", scheme ? "pass" : "fail", "critical", "SchemeInformation element exists.");
  checks.push(...assessTs119612SchemeInformation(document, artifactKind));

  checks.push(bindingSelectionCheck(rootNs, extracted.tslVersionIdentifier));
  checkExists(checks, document, "structure.tsl_version_identifier", D("TSLVersionIdentifier"), "TSLVersionIdentifier exists.", "error");
  if (extracted.tslVersionIdentifier) {
    push(checks, "structure.tsl_version_identifier.value", "structure", extracted.tslVersionIdentifier === "6" ? "pass" : "warn", "warning", "TSLVersionIdentifier expected value is 6 for ETSI TS 119 612 v2.4.1 / TLv6.", extracted.tslVersionIdentifier);
  }
  checkExists(checks, document, "structure.tsl_sequence_number", D("TSLSequenceNumber"), "TSLSequenceNumber exists.", "error");
  checkExists(checks, document, "structure.tsl_type", D("TSLType"), "TSLType exists.", "error");
  checkExists(checks, document, "structure.scheme_operator_name", D("SchemeOperatorName"), "SchemeOperatorName exists.", "error");
  checkExists(checks, document, "structure.scheme_operator_address", D("SchemeOperatorAddress"), "SchemeOperatorAddress exists.", "error");
  checkExists(checks, document, "structure.scheme_name", D("SchemeName"), "SchemeName exists.", "error");
  checkExists(checks, document, "structure.scheme_information_uri", D("SchemeInformationURI"), "SchemeInformationURI exists.", "error");
  checkExists(checks, document, "structure.status_determination_approach", D("StatusDeterminationApproach"), "StatusDeterminationApproach exists.", "error");
  if (extracted.statusDeterminationApproach) {
    push(checks, "structure.status_determination_approach.value", "structure", extracted.statusDeterminationApproach === EU_APPROPRIATE ? "pass" : "warn", "warning", "StatusDeterminationApproach common expected value is EUappropriate.", extracted.statusDeterminationApproach);
  }
  checkExists(checks, document, "structure.scheme_type_community_rules", D("SchemeTypeCommunityRules"), "SchemeTypeCommunityRules exists.", "error");
  checkExists(checks, document, "structure.scheme_territory", D("SchemeTerritory"), "SchemeTerritory exists.", "error");
  checkExists(checks, document, "structure.list_issue_date_time", D("ListIssueDateTime"), "ListIssueDateTime exists.", "error");
  checkExists(checks, document, "structure.next_update", D("NextUpdate"), "NextUpdate exists.", "error");
  checkExists(checks, document, "structure.distribution_points", D("DistributionPoints"), "DistributionPoints exists.", "warning");
  checks.push(...dateChecks(
    extracted.listIssueDateTime,
    extracted.nextUpdate,
    assessmentDate,
    has(document, D("NextUpdate")),
  ));
  const pointerAssessment = assessTs119612Pointers(document, artifactKind, assessmentDate);
  checks.push(...pointerAssessment.checks);
  certificates.push(...pointerAssessment.certificates);
  const serviceAssessment = assessTs119612TspServices(document, artifactKind, assessmentDate);
  checks.push(...serviceAssessment.checks);
  if (artifactKind === "ts119612_xml_tsl") checks.push(...assessTs119612ServiceSemantics(document));
  certificates.push(...serviceAssessment.certificates);
  extracted.certificates = certificates;
  extracted.trustServiceProviderCount = serviceAssessment.tspCount;
  extracted.serviceCount = serviceAssessment.serviceCount;
  const ts119612Coverage = auditTs119612Coverage(artifactKind, checks);
  checks.push(ts119612CoverageFinding(ts119612Coverage));

  const mandatoryFailures = checks
    .filter((check) => check.status === "fail" && (check.severity === "critical" || check.severity === "error"))
    .map((check) => `${check.id}: ${check.message}`);
  const warnings = checks
    .filter((check) => ["warn", "not_checked", "unsupported", "inconclusive"].includes(check.status))
    .map((check) => `${check.id}: ${check.message}`);
  const score = scoreChecks(checks, options.strict);
  const conformanceLevel = determineLevel(checks, mandatoryFailures, options.strict, ts119612Coverage.completeVerdictEligible);
  const ts119612Facts = extractTs119612ValidatedFacts(document, checks, assessmentDate);

  return {
    detected: { format: "xml", artifactKind },
    ts119612: {
      applicable: true,
      conformanceLevel,
      score,
      checks,
      mandatoryFailures,
      warnings,
    },
    ts119612Coverage,
    extracted,
    ts119612Facts,
  };
}

function isTs119612Namespace(namespace: string | undefined): boolean {
  return namespace === CANONICAL_ETSI_NS || namespace === EUDI_RI_ETSI_NS_VARIANT;
}

function bindingSelectionCheck(namespace: string | undefined, versionIdentifier: string | undefined): CheckResult {
  const canonical = namespace === TS119612_SOURCE.canonicalNamespace;
  const versionMatches = versionIdentifier === String(TS119612_SOURCE.tslVersionIdentifier);
  const compatibilityInput = TS119612_COMPATIBILITY_INPUTS.find((entry) => entry.namespace === namespace);
  if (canonical && versionMatches) {
    return {
      id: "ts119612.binding.supported",
      category: "profile",
      status: "pass",
      severity: "info",
      message: "Artifact evidence selects the supported ETSI TS 119 612 V2.4.1 XML binding.",
      evidence: { standard: TS119612_SOURCE, observedNamespace: namespace, observedTslVersionIdentifier: versionIdentifier },
    };
  }
  return {
    id: "ts119612.binding.supported",
    category: "profile",
    status: canonical ? "fail" : "warn",
    severity: canonical ? "error" : "warning",
    message: canonical
      ? "The canonical namespace is present, but TSLVersionIdentifier does not select the supported V2.4.1 format version."
      : "The artifact uses an observed compatibility namespace whose normative TS 119 612 V2.4.1 status is not established.",
    evidence: {
      standard: TS119612_SOURCE,
      observedNamespace: namespace,
      observedTslVersionIdentifier: versionIdentifier,
      compatibilityInput,
    },
  };
}

function isLotlTslType(tslType: string | undefined): boolean {
  return /(?:listofthelists|listoflists|lotl)/i.test(tslType ?? "");
}

function isLotlOrLoteType(tslType: string | undefined): boolean {
  return /(?:listofthelists|listoflists|lotl|lote)/i.test(tslType ?? "");
}

function extractMetadata(document: Document): ExtractedMetadata {
  return {
    tslVersionIdentifier: text(document, D("TSLVersionIdentifier")),
    tslSequenceNumber: text(document, D("TSLSequenceNumber")),
    tslType: text(document, D("TSLType")),
    schemeOperatorName: texts(document, `${D("SchemeOperatorName")}//*[local-name()='Name'] | ${D("SchemeOperatorName")}`),
    schemeName: texts(document, `${D("SchemeName")}//*[local-name()='Name'] | ${D("SchemeName")}`),
    schemeTerritory: text(document, D("SchemeTerritory")),
    statusDeterminationApproach: text(document, D("StatusDeterminationApproach")),
    listIssueDateTime: text(document, D("ListIssueDateTime")),
    nextUpdate: text(document, `${D("NextUpdate")}//*[local-name()='dateTime'] | ${D("NextUpdate")}`),
    distributionPoints: texts(document, `${D("DistributionPoints")}//*[local-name()='URI']`),
  };
}

function dateChecks(
  issueValue: string | undefined,
  nextValue: string | undefined,
  assessmentDate: Date,
  nextUpdatePresent: boolean,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const issue = parseDate(issueValue);
  const next = parseDate(nextValue);
  push(checks, "dates.issue_valid", "dates", issue ? "pass" : "fail", "error", "ListIssueDateTime uses the required UTC seconds lexical form.", issueValue);
  if (!nextValue && nextUpdatePresent) {
    push(checks, "dates.next_update_valid", "dates", "not_applicable", "info", "NextUpdate date-time syntax is not applicable to an explicitly closed TL.");
  } else {
    push(checks, "dates.next_update_valid", "dates", next ? "pass" : "fail", "error", "NextUpdate uses the required UTC seconds lexical form.", nextValue);
  }
  if (issue && next) {
    push(checks, "dates.next_after_issue", "dates", next > issue ? "pass" : "fail", "error", "NextUpdate is after ListIssueDateTime.", { issue: issue.toISOString(), nextUpdate: next.toISOString() });
    const limit = addUtcCalendarMonths(issue, 6);
    push(
      checks,
      "dates.update_period_days",
      "dates",
      next <= limit ? "pass" : "fail",
      "error",
      "NextUpdate is no later than six calendar months after ListIssueDateTime.",
      { issue: issue.toISOString(), nextUpdate: next.toISOString(), sixCalendarMonthLimit: limit.toISOString() },
    );
  }
  if (next) {
    const expired = assessmentDate > next;
    checks.push({
      id: "dates.next_update_expired",
      category: "dates",
      status: expired ? "warn" : "pass",
      severity: expired ? "warning" : "info",
      message: expired
        ? "Current assessment date is after NextUpdate; trusted list appears expired."
        : "Current assessment date is not after NextUpdate.",
      evidence: { assessmentDate: assessmentDate.toISOString(), nextUpdate: next.toISOString() },
    });
  }
  return checks;
}

function parseDate(value: string | undefined): Date | undefined {
  return validateTs119602UtcDateTime(value).outcome === "valid" ? new Date(value as string) : undefined;
}

function addUtcCalendarMonths(value: Date, months: number): Date {
  const monthIndex = value.getUTCMonth() + months;
  const year = value.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(value.getUTCDate(), lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
  ));
}

function checkExists(checks: CheckResult[], context: Node, id: string, expression: string, message: string, severity: "critical" | "error" | "warning"): void {
  const present = has(context, expression);
  push(checks, id, severity === "warning" ? "profile" : "structure", present ? "pass" : severity === "warning" ? "warn" : "fail", severity, message);
}

function push(
  checks: CheckResult[],
  id: string,
  category: CheckResult["category"],
  status: CheckResult["status"],
  severity: CheckResult["severity"],
  message: string,
  evidence?: unknown,
): void {
  checks.push({ id, category, status, severity, message, evidence });
}

function hasSchemaLocation(root: Element): boolean {
  return Boolean(schemaLocation(root));
}

function schemaLocation(root: Element): string | undefined {
  return (
    root.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "schemaLocation")
    ?? root.getAttribute("xsi:schemaLocation")
    ?? undefined
  );
}

function scoreChecks(checks: CheckResult[], strict: boolean): number {
  let score = 100;
  for (const check of checks) {
    if (check.status === "fail" && check.severity === "critical") score -= 30;
    else if (check.status === "fail" && check.severity === "error") score -= 15;
    else if (check.status === "warn") score -= 5;
    else if (strict && check.status === "not_checked") score -= 5;
  }
  return Math.max(0, score);
}

function determineLevel(checks: CheckResult[], mandatoryFailures: string[], strict: boolean, coverageComplete: boolean): ConformanceLevel {
  const criticalFailures = checks.filter((check) => check.status === "fail" && check.severity === "critical");
  if (criticalFailures.length > 0 || mandatoryFailures.length >= 3) return "non_conformant";
  if (mandatoryFailures.length > 0) return strict ? "non_conformant" : "partially_conformant";
  if (checks.some((check) => check.status === "unsupported")) return "unsupported";
  if (checks.some((check) => check.status === "inconclusive")) return "inconclusive";
  if (!coverageComplete) return "not_checked";
  const notChecked = checks.some((check) => check.status === "not_checked");
  const warnings = checks.some((check) => check.status === "warn");
  if (notChecked) return "not_checked";
  if (warnings) return "partially_conformant";
  return "conformant";
}

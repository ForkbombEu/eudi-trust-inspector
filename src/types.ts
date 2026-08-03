import type { EudiTrustRole } from "./eudi/roles.js";
import type { Ts119602CoverageAudit } from "./standards/ts119602Coverage.js";
import type { Ts119612CoverageAudit } from "./standards/ts119612Coverage.js";

export type ConformanceLevel =
  | "conformant"
  | "partially_conformant"
  | "non_conformant"
  | "not_applicable"
  | "not_checked"
  | "unsupported"
  | "inconclusive"
  | "fetch_failed"
  | "parse_failed";

export type DetectedFormat = "xml" | "json" | "jws" | "html" | "text" | "empty" | "unknown";

export type ArtifactKind =
  | "ts119612_xml_tsl"
  | "ts119612_xml_lotl"
  | "xml_lotl_like"
  | "xml_lote"
  | "json_lote"
  | "json_lotl"
  | "html_error"
  | "unknown";

export type ApplicabilityStatus = "applicable" | "not_applicable" | "unknown";

export interface StandardApplicability {
  ts119612: ApplicabilityStatus;
  ts119602: ApplicabilityStatus;
  weBuildProfile: ApplicabilityStatus;
  eudiTrustRole: ApplicabilityStatus;
}

export type Ts119602DataModel = "ts119602" | "ts119612" | "unknown";
export type Ts119602Binding =
  | "scheme_explicit_json"
  | "scheme_explicit_xml"
  | "ts119612_alternative_xml"
  | "unknown";
export type Ts119602Profile =
  | "pid_providers"
  | "wallet_providers"
  | "wrpac_providers"
  | "wrprc_providers"
  | "pub_eaa_providers"
  | "registrars_and_registers"
  | "unknown";
export type Ts119602BindingStatus = "selected" | "candidate" | "unsupported" | "not_applicable";
export type Ts119602ProfileStatus = "selected" | "not_selected" | "conflict";

export interface Ts119602Classification {
  dataModel: Ts119602DataModel;
  binding: Ts119602Binding;
  bindingStatus: Ts119602BindingStatus;
  profile: Ts119602Profile;
  profileStatus: Ts119602ProfileStatus;
  applicability: ApplicabilityStatus;
  reasons: string[];
  evidence: {
    rootLocalName?: string;
    rootNamespace?: string;
    embeddedType?: string;
    declaredType?: string;
    embeddedProfile?: Ts119602Profile;
    declaredProfile?: Ts119602Profile;
  };
}

export type CheckStatus =
  | "pass"
  | "fail"
  | "warn"
  | "not_applicable"
  | "not_checked"
  | "unsupported"
  | "inconclusive";
export type CheckSeverity = "info" | "warning" | "error" | "critical";

export interface CheckResult {
  id: string;
  category:
    | "fetch"
    | "parse"
    | "schema"
    | "structure"
    | "dates"
    | "signature"
    | "xades"
    | "services"
    | "certificates"
    | "profile";
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  evidence?: unknown;
}

export interface ContextArtifactInput {
  content: string;
  source?: string;
  contentType?: string;
}

export interface Ts119612RevocationEvidence {
  status: "good" | "revoked" | "unknown";
  source: string;
  checkedAt: string;
  nextUpdate?: string;
  signerFingerprintSha256: string;
}

export interface Ts119612SignerEvidence {
  /** Issuer certificates between the embedded TLSO certificate and a separately supplied anchor. */
  intermediateCertificates?: string[];
  /** Explicit trust anchors; embedded ds:KeyInfo material is never copied into this set implicitly. */
  trustAnchors?: string[];
  /** Externally obtained revocation evidence for the embedded TLSO certificate. */
  revocation?: Ts119612RevocationEvidence;
}

export interface TrustListPointerSignerEvidence extends Ts119612SignerEvidence {
  /** Exact LoTELocation to which this separately supplied evidence applies. */
  location: string;
}

export type Ts119602ResourceAssertion =
  | "scheme_scope_and_context"
  | "approval_scheme"
  | "operator_approval_process"
  | "entity_approval_process"
  | "approval_criteria"
  | "assessor_selection_and_rules"
  | "separate_body_responsibilities_and_liabilities"
  | "scheme_contact_information"
  | "scheme_policy_and_rules"
  | "list_usage_and_interpretation"
  | "policy_or_legal_notice";

/** Human-reviewed semantics bound to the exact bytes fetched from a declared URI. */
export interface Ts119602ResourceEvidence {
  location: string;
  sha256: string;
  assertions: Ts119602ResourceAssertion[];
  source: string;
  checkedAt: string;
}

export interface Ts119602PostalAddressEvidence {
  streetAddress: string;
  country: string;
}

export interface Ts119602AuthoritativeIdentityEvidence {
  source: string;
  checkedAt: string;
  names: string[];
  registrationIdentifiers?: string[];
  postalAddresses: Ts119602PostalAddressEvidence[];
  electronicAddresses: string[];
  /** Names of associated bodies whose asserted relationship/responsibility was confirmed by the source. */
  associatedBodies?: string[];
}

export interface Ts119602AuthoritativeEntityEvidence extends Ts119602AuthoritativeIdentityEvidence {
  /** Exact parser evidence path of the TrustedEntity to which this record applies. */
  entityPath: string;
}

export interface Ts119602AuthoritativeEvidence {
  schemeOperator?: Ts119602AuthoritativeIdentityEvidence;
  entities?: Ts119602AuthoritativeEntityEvidence[];
}

export interface Ts119602ContextualEvidence {
  resources?: Ts119602ResourceEvidence[];
  authoritative?: Ts119602AuthoritativeEvidence;
  /** Profile- or scheme-defined ServiceStatus URI values whose semantics are exactly "expired". */
  expiredServiceStatusUris?: string[];
}

/** Optional evidence and limits shared by TS 119 612 and TS 119 602 contextual checks. */
export interface TrustListContextOptions {
  dereference?: boolean;
  priorArtifacts?: ContextArtifactInput[];
  trustedSignerFingerprintsSha256?: string[];
  ts119612Signer?: Ts119612SignerEvidence;
  /** Separately supplied path/revocation evidence keyed by exact pointer location. */
  pointerSigners?: TrustListPointerSignerEvidence[];
  /** TS 119 602-only reviewed resource, authoritative-record, and status-policy evidence. */
  ts119602?: Ts119602ContextualEvidence;
  maxDereferences?: number;
  maxBytesPerArtifact?: number;
  concurrency?: number;
  /** Maximum number of TS 119 612 pointer or TS 119 602 archive-index edges followed. */
  maxTraversalDepth?: number;
}

/** @deprecated Historical name retained for source compatibility. */
export type Ts119602ContextOptions = TrustListContextOptions;

export interface StandardAssessment {
  applicable: boolean;
  conformanceLevel: ConformanceLevel;
  score: number | null;
  checks: CheckResult[];
  mandatoryFailures: string[];
  warnings: string[];
}

export interface CertificateSummary {
  source: "pointer" | "xml_signature" | "json_signature" | "service_digital_identity";
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  fingerprintSha256?: string;
  validAtAssessmentTime?: boolean;
}

export interface ReferenceProfileAssessment {
  applicability: ApplicabilityStatus;
  recognized: boolean;
  recognitionReasons: string[];
  observedRoles: EudiTrustRole[];
  checks: CheckResult[];
}

export interface ArtifactReferenceProfiles {
  eudiRiTs119612: ReferenceProfileAssessment;
  weBuildTs119612: ReferenceProfileAssessment;
}

export interface AuditReport {
  schemaVersion: 7;
  tool: {
    name: "we-build-tl-audit";
    version: string;
  };
  generatedAt: string;
  input: {
    source: string;
    kind: "file" | "url" | "json" | "xml";
    sha256?: string;
  };
  lotl: {
    schemeOperatorName?: string;
    schemeName?: string;
    loteType?: string;
    sequenceNumber?: number;
    issueDateTime?: string;
    nextUpdate?: string;
    pointerCount: number;
    uniqueLocationCount: number;
    duplicateLocations: string[];
  };
  weBuildProfile: {
    recognized: boolean;
    recognitionReasons: string[];
    listTypeCounts: Record<string, number>;
    roleCounts: Record<string, number>;
    pointerConsistency: {
      declaredMimeMismatches: number;
      duplicateLocations: number;
      pointersMissingServiceDigitalIdentities: number;
      pointersMissingQualifiers: number;
      pointerCertificatesParsed: number;
      pointerCertificatesInvalidAtAssessment: number;
    };
  };
  fixtureReadiness: FixtureReadiness;
  fcafTrustedAuthorities: FcafTrustedAuthoritiesReadiness;
  negativeFixtureDescriptors: NegativeFixtureDescriptor[];
  summary: {
    totalPointers: number;
    fetched: number;
    fetchFailed: number;
    xmlArtifacts: number;
    jsonArtifacts: number;
    unknownArtifacts: number;
    ts119612: {
      conformant: number;
      partiallyConformant: number;
      nonConformant: number;
      notApplicable: number;
      notChecked: number;
      unsupported: number;
      inconclusive: number;
      parseFailed: number;
    };
    ts119602: {
      conformant: number;
      partiallyConformant: number;
      nonConformant: number;
      notApplicable: number;
      notChecked: number;
      unsupported: number;
      inconclusive: number;
      parseFailed: number;
    };
  };
  results: TrustedListAuditResult[];
}

export interface TrustedListAuditResult {
  /** Stable within a report for the same pointer position and location. */
  id: string;
  index: number;
  /** The assessed artifact source URL or path. */
  source: string;
  /** @deprecated Use source. Retained for existing integrations. */
  location: string;
  declared: {
    mimeType?: string;
    loteType?: string;
    schemeOperatorName?: string;
    schemeTerritory?: string;
    pointerCertificateFingerprintsSha256: string[];
  };
  fetch: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    statusText?: string;
    finalUrl?: string;
    contentType?: string;
    durationMs?: number;
    sha256?: string;
    bytes?: number;
    error?: string;
  };
  detected: {
    format: DetectedFormat;
    artifactKind: ArtifactKind;
  };
  ts119602Classification: Ts119602Classification;
  standardApplicability: StandardApplicability;
  /** Full 69-family engineering coverage audit for applicable TS 119 612 XML artifacts. */
  ts119612Coverage?: Ts119612CoverageAudit;
  /** Full 81-family engineering coverage audit for applicable TS 119 602 artifacts. */
  ts119602Coverage?: Ts119602CoverageAudit;
  referenceProfiles: ArtifactReferenceProfiles;
  ts119612: StandardAssessment;
  ts119602: StandardAssessment;
  extracted?: {
    tslVersionIdentifier?: string;
    tslSequenceNumber?: string;
    tslType?: string;
    schemeOperatorName?: string[];
    schemeName?: string[];
    schemeTerritory?: string;
    statusDeterminationApproach?: string;
    listIssueDateTime?: string;
    nextUpdate?: string;
    distributionPoints?: string[];
    trustServiceProviderCount?: number;
    serviceCount?: number;
    certificates?: CertificateSummary[];
    jsonLote?: Record<string, unknown>;
  };
}

export interface PointerInfo {
  index: number;
  location: string;
  declared: TrustedListAuditResult["declared"];
  raw: unknown;
}

export interface CliOptions {
  input: string;
  outDir: string;
  concurrency: number;
  timeoutMs: number;
  xsd?: string;
  strict: boolean;
  includeJsonLoteChecks: boolean;
  fetch: boolean;
  rpacChain?: string;
  contextual: boolean;
  priorLote?: string;
  generateNegativeFixtures?: boolean;
}

export interface FixtureReadiness {
  usableForWalletTrustFixture: boolean;
  verdict: "ready" | "not_ready" | "partially_ready" | "not_checked";
  checks: CheckResult[];
  caveats: string[];
  rpacChain?: {
    chainStructurallyValid: boolean;
    trustedByTlLote: boolean;
  };
}

export type FixtureScenarioStatus = "ready" | "not_ready" | "partially_ready" | "not_checked";

export type FcafTrustedAuthoritiesScenarioId =
  | "aki_positive_match_possible"
  | "aki_no_match_possible"
  | "etsi_tl_positive_match_possible"
  | "etsi_tl_no_match_possible"
  | "etsi_tl_unreachable_negative_possible"
  | "etsi_tl_invalid_signature_negative_possible"
  | "etsi_tl_cascading_lotl_tl_possible"
  | "rpac_chain_to_access_ca_possible";

export interface FcafTrustedAuthoritiesScenario {
  id: FcafTrustedAuthoritiesScenarioId;
  status: FixtureScenarioStatus;
  evidence: Record<string, unknown>;
  missingPrerequisites: string[];
}

export interface FcafTrustedAuthoritiesReadiness {
  scenarios: FcafTrustedAuthoritiesScenario[];
}

export type NegativeFixtureDescriptorId =
  | "unknown_access_ca"
  | "expired_rpac"
  | "wrong_lote_or_list_type"
  | "unreachable_tl_url"
  | "invalid_tl_signature"
  | "missing_trust_anchor"
  | "rpac_chain_not_anchored"
  | "requested_verifier_role_not_present";

export interface NegativeFixtureDescriptor {
  id: NegativeFixtureDescriptorId;
  status: FixtureScenarioStatus;
  title: string;
  sourceArtifacts: string[];
  evidence: Record<string, unknown>;
  steps: string[];
  missingPrerequisites: string[];
}

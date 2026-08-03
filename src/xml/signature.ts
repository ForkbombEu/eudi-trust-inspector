import { certificateFingerprintSha256, tryCertificateFromBase64 } from "../certs.js";
import type { CertificateSummary, CheckResult } from "../types.js";
import { has, texts } from "./xpath.js";
import { assessXadesSignature, type XadesAssessmentOptions } from "./xades.js";
import { assessTs119612SignatureProfile } from "./ts119612Signature.js";
import { inspectReferences, verifyXmlSignatureWithXmlsec } from "./xmlsec.js";

export interface SignatureAssessment {
  checks: CheckResult[];
  certificates: CertificateSummary[];
}

export interface SignatureVerificationResult {
  status: Extract<CheckResult["status"], "pass" | "fail" | "not_checked">;
  message: string;
  evidence?: unknown;
  attempted?: boolean;
}

export type SignatureVerifier = (
  xml: string,
  document: Document,
  signatureNode: Element,
  certificate: string,
) => SignatureVerificationResult | Promise<SignatureVerificationResult>;

export interface SignatureAssessmentDependencies {
  verifier?: SignatureVerifier;
}

export interface SignatureAssessmentOptions extends XadesAssessmentOptions {
  /** Require one list ServiceDigitalIdentity certificate to equal the XMLDSig signing certificate. */
  requireListCertificateMatch?: boolean;
  /** @deprecated Use requireListCertificateMatch. */
  requireFirstListCertificateMatch?: boolean;
  /** Apply ETSI TS 119 612 V2.4.1 clauses 5.7 and normative Annex B. */
  requireTs119612Profile?: boolean;
  ts119612SignerEvidence?: import("../types.js").Ts119612SignerEvidence;
}

export async function assessSignature(
  xml: string,
  document: Document,
  assessmentDate = new Date(),
  dependencies: SignatureAssessmentDependencies = {},
  options: SignatureAssessmentOptions = {},
): Promise<SignatureAssessment> {
  const checks: CheckResult[] = [];
  const certificates: CertificateSummary[] = [];
  const requireListCertificateMatch = options.requireListCertificateMatch
    ?? options.requireFirstListCertificateMatch
    ?? false;
  const signatureNode = document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]
    ?? document.getElementsByTagName("Signature")[0];

  if (!signatureNode) {
    checks.push(
      check("signature.present", "fail", "error", "No ds:Signature element detected."),
      check("signature.signing_certificate_present", "not_checked", "info", "Signing certificate presence was not checked because ds:Signature is absent."),
      check("signature.signing_certificate_parsed", "not_checked", "info", "Signing certificate parsing was not checked because ds:Signature is absent."),
      check("signature.cryptographic_verification_attempted", "not_checked", "info", "Cryptographic verification was not attempted because ds:Signature is absent."),
      check("signature.cryptographic_verification_result", "not_checked", "info", "Cryptographic verification has no result because ds:Signature is absent."),
      check("signature.xades_properties_detected", "not_checked", "info", "XAdES properties were not checked because ds:Signature is absent."),
    );
    if (requireListCertificateMatch) {
      checks.push(...listCertificateChecks(document, undefined));
    }
    checks.push(...assessXadesSignature(document, undefined, undefined, undefined, options));
    if (options.requireTs119612Profile) {
      checks.push(...assessTs119612SignatureProfile(document, undefined, undefined, undefined, {
        assessmentDate,
        signerEvidence: options.ts119612SignerEvidence,
        trustedSignerFingerprintsSha256: options.trustedSignerFingerprintsSha256,
      }));
    }
    return { checks, certificates };
  }

  checks.push(check("signature.present", "pass", "info", "ds:Signature element detected."));

  const certificateTexts = texts(signatureNode, ".//*[local-name()='KeyInfo']//*[local-name()='X509Certificate']");
  checks.push(check(
    "signature.signing_certificate_present",
    certificateTexts.length > 0 ? "pass" : "fail",
    certificateTexts.length > 0 ? "info" : "warning",
    certificateTexts.length > 0
      ? "Embedded ds:X509Certificate material detected in ds:KeyInfo."
      : "No embedded ds:X509Certificate material detected in ds:KeyInfo.",
    certificateTexts.length > 0 ? { count: certificateTexts.length } : undefined,
  ));

  const parsedCertificateEntries = certificateTexts
    .map((certificate) => ({ certificate, summary: tryCertificateFromBase64(certificate, "xml_signature", assessmentDate) }))
    .filter((entry): entry is { certificate: string; summary: CertificateSummary } => Boolean(entry.summary));
  const parsedCertificates = parsedCertificateEntries.map((entry) => entry.summary);
  certificates.push(...parsedCertificates);
  checks.push(check(
    "signature.signing_certificate_parsed",
    certificateTexts.length === 0 ? "not_checked" : parsedCertificates.length === certificateTexts.length ? "pass" : "fail",
    certificateTexts.length === 0 ? "info" : parsedCertificates.length === certificateTexts.length ? "info" : "warning",
    certificateTexts.length === 0
      ? "Signing certificate parsing was not attempted because no embedded certificate was supplied."
      : parsedCertificates.length === certificateTexts.length
        ? "All embedded signing certificates parsed."
        : "One or more embedded signing certificates could not be parsed.",
    certificateTexts.length === 0 ? undefined : {
      present: certificateTexts.length,
      parsed: parsedCertificates.length,
      certificates: parsedCertificates,
    },
  ));

  const verificationEntry = parsedCertificateEntries[0];
  const referenceEvidence = inspectReferences(document, signatureNode);
  const referencesPresentAndLocal = referenceEvidence.uris.length > 0
    && referenceEvidence.prohibitedUris.length === 0;
  checks.push(
    check(
      "signature.reference_uris",
      referencesPresentAndLocal ? "pass" : "fail",
      referencesPresentAndLocal ? "info" : "error",
      referenceEvidence.uris.length === 0
        ? "No XMLDSig Reference element was found in SignedInfo."
        : referenceEvidence.prohibitedUris.length === 0
        ? "All XMLDSig Reference URIs are empty or same-document references."
        : "One or more XMLDSig Reference URIs are external or unsupported.",
      referenceEvidence,
    ),
    check(
      "signature.expected_root_reference",
      referenceEvidence.expectedRootCovered ? "pass" : "fail",
      referenceEvidence.expectedRootCovered ? "info" : "error",
      referenceEvidence.expectedRootCovered
        ? "An XMLDSig Reference covers the expected document root."
        : "No XMLDSig Reference covers the expected document root.",
      referenceEvidence,
    ),
  );
  if (!verificationEntry) {
    checks.push(
      check("signature.cryptographic_verification_attempted", "not_checked", "info", "Cryptographic verification was not attempted because no parseable embedded signing certificate is available."),
      check("signature.cryptographic_verification_result", "not_checked", "info", "Cryptographic verification has no result because no parseable embedded signing certificate is available."),
    );
  } else {
    const verifier = dependencies.verifier
      ?? ((inputXml: string, inputDocument: Document, inputSignature: Element, inputCertificate: string) =>
        verifyXmlSignatureWithXmlsec(inputXml, inputDocument, inputSignature, inputCertificate));
    const verification = await verifier(xml, document, signatureNode, verificationEntry.certificate);
    const attempted = verification.attempted ?? true;
    checks.push(check(
      "signature.cryptographic_verification_attempted",
      attempted ? "pass" : "not_checked",
      "info",
      attempted
        ? "Cryptographic verification was attempted with xmlsec1 and the first parseable ds:KeyInfo X.509 certificate."
        : "Cryptographic verification was not attempted because the xmlsec1 backend was unavailable or the reference policy rejected the signature.",
    ));
    checks.push(check(
      "signature.cryptographic_verification_result",
      verification.status,
      verification.status === "pass" ? "info" : verification.status === "fail" ? "error" : "warning",
      verification.message,
      verification.evidence,
    ));
  }

  if (requireListCertificateMatch) {
    checks.push(...listCertificateChecks(document, verificationEntry?.certificate));
  }

  const xadesDetected = has(document, "//*[local-name()='QualifyingProperties']") || has(document, "//*[local-name()='SignedProperties']");
  checks.push(check(
    "signature.xades_properties_detected",
    xadesDetected ? "pass" : "warn",
    xadesDetected ? "info" : "warning",
    xadesDetected
      ? "XAdES qualifying properties detected."
      : "XAdES Baseline-B material not detected; XMLDSig presence alone may not satisfy the intended signature profile.",
  ));

  checks.push(...assessXadesSignature(
    document,
    signatureNode,
    verificationEntry?.certificate,
    verificationEntry?.summary,
    options,
  ));
  if (options.requireTs119612Profile) {
    checks.push(...assessTs119612SignatureProfile(
      document,
      signatureNode,
      verificationEntry?.certificate,
      verificationEntry?.summary,
      {
        assessmentDate,
        signerEvidence: options.ts119612SignerEvidence,
        trustedSignerFingerprintsSha256: options.trustedSignerFingerprintsSha256,
      },
    ));
  }

  return { checks, certificates };
}

function listCertificateChecks(document: Document, signingCertificate: string | undefined): CheckResult[] {
  const listCertificates = texts(
    document,
    "//*[local-name()='TrustServiceProviderList']//*[local-name()='ServiceDigitalIdentity']//*[local-name()='X509Certificate'] | //*[local-name()='OtherTSLPointer']//*[local-name()='ServiceDigitalIdentity']//*[local-name()='X509Certificate']",
  );

  if (listCertificates.length === 0) {
    return [check(
      "signature.list_certificate_present",
      "fail",
      "error",
      "No list ServiceDigitalIdentity certificate is present for comparison with ds:KeyInfo.",
    )];
  }

  if (!signingCertificate) {
    return [check(
      "signature.list_certificate_exact_match",
      "not_checked",
      "info",
      "List certificates were not compared because ds:KeyInfo has no parseable signing certificate.",
      { listCertificateCount: listCertificates.length },
    )];
  }

  const listCertificateFingerprints = listCertificates.map(certificateFingerprintSha256);
  const signingCertificateFingerprint = certificateFingerprintSha256(signingCertificate);
  if (!signingCertificateFingerprint) {
    return [check(
      "signature.list_certificate_exact_match",
      "fail",
      "error",
      "The ds:KeyInfo signing certificate could not be decoded for exact comparison with list certificates.",
      {
        listCertificateFingerprintsSha256: listCertificateFingerprints.map((fingerprint) => fingerprint ?? null),
        matchingListCertificateIndexes: [],
        signingCertificateFingerprintSha256: signingCertificateFingerprint,
      },
    )];
  }

  const matchingListCertificateIndexes = listCertificateFingerprints
    .map((fingerprint, index) => fingerprint === signingCertificateFingerprint ? index + 1 : undefined)
    .filter((index): index is number => index !== undefined);
  const matches = matchingListCertificateIndexes.length > 0;
  return [check(
    "signature.list_certificate_exact_match",
    matches ? "pass" : "fail",
    matches ? "info" : "error",
    matches
      ? "A list ServiceDigitalIdentity certificate exactly equals the ds:KeyInfo signing certificate."
      : "No list ServiceDigitalIdentity certificate exactly equals the ds:KeyInfo signing certificate.",
    {
      listCertificateFingerprintsSha256: listCertificateFingerprints.map((fingerprint) => fingerprint ?? null),
      matchingListCertificateIndexes,
      signingCertificateFingerprintSha256: signingCertificateFingerprint,
    },
  )];
}

function check(
  id: string,
  status: CheckResult["status"],
  severity: CheckResult["severity"],
  message: string,
  evidence?: unknown,
): CheckResult {
  return { id, category: id === "signature.xades_properties_detected" ? "xades" : "signature", status, severity, message, evidence };
}

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseXml } from "../src/xml/parse.js";
import { assessSignature } from "../src/xml/signature.js";

const sameKeyFirstCertificate = "MIIDXTCCAkWgAwIBAgIUI7ydpvHZjystVobOoXUh9vK+2wEwDQYJKoZIhvcNAQELBQAwPjEXMBUGA1UEAwwOU2FtZSBLZXkgRmlyc3QxFjAUBgNVBAoMDVdFIEJVSUxEIFRlc3QxCzAJBgNVBAYTAkVVMB4XDTI2MDcxNzE0MTYwNloXDTM2MDcxNDE0MTYwNlowPjEXMBUGA1UEAwwOU2FtZSBLZXkgRmlyc3QxFjAUBgNVBAoMDVdFIEJVSUxEIFRlc3QxCzAJBgNVBAYTAkVVMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1ioHvB5HU0PcFtINk3fXuIbQNwkw6PsFjElNC1hx7FoF41WXLbP8AT2AJXRSLcndKJJgdG3qndWA0I8vN5lQ04svcZKqyPHBBZFaMqCcfrrrSXHng3WEyjM//3dOJWgf3MIQagEG8XT0ethRCyR/xEsN/vO5VI0T9lg8v/sNyKKBSygag0rqBx9ti/37k9L88/WUBgyNpP6TDlBw7y1oYIfMNWlX07mFEjqg/+zsrPka8I4hOq/72PoQx7FwqqHJ3fnU9gpQ0I2tI3F50428PwRcIt5NXRj1MORduPp+vfsb9jvnvLGkmM0pcVyfIlGF4Jw0cczQxat63fx4jv96rwIDAQABo1MwUTAdBgNVHQ4EFgQUIQzka3QV4yjKw2MQMTksShF7iNUwHwYDVR0jBBgwFoAUIQzka3QV4yjKw2MQMTksShF7iNUwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAA6Jk+iACUjLZaUaVNv/PNYqysiJEQcu4VLIiUMWoY1NVF4bAxntwJMznnbhZZhc1dw6rYx/8d1yy++BIfoM2DUGbktk/OJEtmZQeIQDsNtgOrtDtzv0o8AH/fPExmvyiK30Zvas52fHxjJwoyXaSW/vke5Xy7fjv7vVy58tKSJt9WU4o4bnoHyBXUsDzqdFPNHuVjeQHpUwqJ7G3d0Ym9QssXkwwgLM1S9Mm6S6ujTLA63WHbx5aN2CAQChi0qgxJpeNtcdOjgWBctgrcAA9ZjPVTspI92DX7MJK4M4dGrvoJGPcgnyVrlGZ/j3KPUxFx67IIw0fuBXhKDZKa9cQ8A==";
const sameKeySecondCertificate = "MIIDXzCCAkegAwIBAgIUPWUjAs/F2yNpap9/OdNGVFKBrxMwDQYJKoZIhvcNAQELBQAwPzEYMBYGA1UEAwwPU2FtZSBLZXkgU2Vjb25kMRYwFAYDVQQKDA1XRSBCVUlMRCBUZXN0MQswCQYDVQQGEwJFVTAeFw0yNjA3MTcxNDE2MDZaFw0zNjA3MTQxNDE2MDZaMD8xGDAWBgNVBAMMD1NhbWUgS2V5IFNlY29uZDEWMBQGA1UECgwNV0UgQlVJTEQgVGVzdDELMAkGA1UEBhMCRVUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDWKge8HkdTQ9wW0g2Td9e4htA3CTDo+wWMSU0LWHHsWgXjVZcts/wBPYAldFItyd0okmB0beqd1YDQjy83mVDTiy9xkqrI8cEFkVoyoJx+uutJceeDdYTKMz//d04laB/cwhBqAQbxdPR62FELJH/ESw3+87lUjRP2WDy/+w3IooFLKBqDSuoHH22L/fuT0vzz9ZQGDI2k/pMOUHDvLWhgh8w1aVfTuYUSOqD/7Oys+RrwjiE6r/vY+hDHsXCqocnd+dT2ClDQja0jcXnTjbw/BFwi3k1dGPUw5F24+n69+xv2O+e8saSYzSlxXJ8iUYXgnDRxzNDFq3rd/HiO/3qvAgMBAAGjUzBRMB0GA1UdDgQWBBQhDORrdBXjKMrDYxAxOSxKEXuI1TAfBgNVHSMEGDAWgBQhDORrdBXjKMrDYxAxOSxKEXuI1TAPBgNVHRMBAf8EBTADAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEACJCNnbLSDaMfMn8QPxpywOJ6Zk+l+NVyoEmbKiAiEGpv/4kVxCFJnL04DcC5TPw75Lz8oj3l2gDKt4wj4NVErZrLTxhvSDBwyv2IcjGK17xX2XGtzbmU0FLZKGi29u4gS9lrSOiPJ4ieKo8GCO0e3LTf1XdWanah+4Xjjfj+2ZkjTuKTwNfqycSmnjvs+eZt6UDVYEWDE94TrwntVtRVmpt/gu/Qm7JwLRCf1Qqf1rh20npJm6QHewu9lT8vM19Za0Zyz/4JhvFdqtqAo1jGiHuG+aJM/xFI4ghMzH57dqBqmtuesHiTWxHfwZxPktS3Zt+MOfyA/1asAj6YfJ4SNd";

async function signedFixture(): Promise<string> {
  return readFile("test/fixtures/tsl-signed-unsupported.xml", "utf8");
}

async function xadesFixture(): Promise<string> {
  const [template, signed] = await Promise.all([
    readFile("test/fixtures/ts119602-pub-eaa-xades-b.xml", "utf8"),
    signedFixture(),
  ]);
  const certificate = signed.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)?.[1];
  if (!certificate) throw new Error("Signed fixture must contain a certificate.");
  return template.replace("{{SIGNING_CERTIFICATE}}", certificate);
}

function withListCertificates(xml: string, certificates: string[]): string {
  return xml.replace(
    "<TrustServiceProviderList />",
    `<TrustServiceProviderList><TrustServiceProvider><TSPServices><TSPService><ServiceInformation><ServiceDigitalIdentity>${certificates.map((certificate) => `<DigitalId><X509Certificate>${certificate}</X509Certificate></DigitalId>`).join("")}</ServiceDigitalIdentity></ServiceInformation></TSPService></TSPServices></TrustServiceProvider></TrustServiceProviderList>`,
  );
}

describe("assessSignature", () => {
  it("reports an unsigned XML artifact with explicit unattempted signature checks", async () => {
    const xml = await readFile("test/fixtures/tsl-valid-ish.xml", "utf8");
    const document = parseXml(xml).document;
    if (!document) throw new Error("Fixture must parse.");
    const result = await assessSignature(xml, document);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "signature.present", status: "fail" }),
        expect.objectContaining({ id: "signature.signing_certificate_present", status: "not_checked" }),
        expect.objectContaining({ id: "signature.cryptographic_verification_attempted", status: "not_checked" }),
        expect.objectContaining({ id: "signature.cryptographic_verification_result", status: "not_checked" }),
        expect.objectContaining({ id: "signature.xades_properties_detected", status: "not_checked" }),
      ]),
    );
  });

  it("extracts signing-certificate evidence and reports unsupported verification without faking success", async () => {
    const xml = await signedFixture();
    const document = parseXml(xml).document;
    if (!document) throw new Error("Fixture must parse.");
    const result = await assessSignature(xml, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({
        status: "not_checked",
        message: "Verification unsupported by the test verifier.",
      }),
    });
    expect(result.certificates).toEqual([
      expect.objectContaining({
        source: "xml_signature",
        subject: expect.any(String),
        issuer: expect.any(String),
        serialNumber: expect.any(String),
        notBefore: expect.any(String),
        notAfter: expect.any(String),
        fingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        validAtAssessmentTime: true,
      }),
    ]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "signature.present", status: "pass" }),
        expect.objectContaining({ id: "signature.signing_certificate_present", status: "pass" }),
        expect.objectContaining({ id: "signature.signing_certificate_parsed", status: "pass" }),
        expect.objectContaining({ id: "signature.reference_uris", status: "fail" }),
        expect.objectContaining({ id: "signature.expected_root_reference", status: "fail" }),
        expect.objectContaining({ id: "signature.cryptographic_verification_attempted", status: "pass" }),
        expect.objectContaining({ id: "signature.cryptographic_verification_result", status: "not_checked" }),
        expect.objectContaining({ id: "signature.xades_properties_detected", status: "pass" }),
      ]),
    );
  });

  it("requires a list certificate to exactly equal the ds:KeyInfo signing certificate", async () => {
    const xml = await signedFixture();
    const signingCertificate = xml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)?.[1];
    if (!signingCertificate) throw new Error("Fixture must contain a signing certificate.");
    const document = parseXml(withListCertificates(xml, [signingCertificate])).document;
    if (!document) throw new Error("Fixture must parse.");

    const result = await assessSignature(xml, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({ status: "pass", message: "Test verifier accepted the signature." }),
    }, { requireListCertificateMatch: true });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "signature.list_certificate_exact_match",
      status: "pass",
      evidence: expect.objectContaining({
        listCertificateFingerprintsSha256: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        matchingListCertificateIndexes: [1],
        signingCertificateFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
  });

  it("accepts a ds:KeyInfo signing certificate that matches a later ServiceDigitalIdentity certificate", async () => {
    const xml = await signedFixture();
    const signingCertificate = xml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/)?.[1];
    if (!signingCertificate) throw new Error("Fixture must contain a signing certificate.");
    const document = parseXml(withListCertificates(xml, [sameKeySecondCertificate, signingCertificate])).document;
    if (!document) throw new Error("Fixture must parse.");

    const result = await assessSignature(xml, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({ status: "pass", message: "Test verifier accepted the signature." }),
    }, { requireListCertificateMatch: true });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "signature.list_certificate_exact_match",
      status: "pass",
      evidence: expect.objectContaining({
        listCertificateFingerprintsSha256: [
          expect.stringMatching(/^[a-f0-9]{64}$/),
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ],
        matchingListCertificateIndexes: [2],
      }),
    }));
  });

  it("fails when certificates share a public key but differ from ds:KeyInfo", async () => {
    const xml = await signedFixture();
    const xmlWithFirstCertificate = xml.replace(/(<ds:X509Certificate>)[^<]+/, `$1${sameKeyFirstCertificate}`);
    const document = parseXml(withListCertificates(xmlWithFirstCertificate, [sameKeySecondCertificate])).document;
    if (!document) throw new Error("Fixture must parse.");

    const result = await assessSignature(xmlWithFirstCertificate, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({ status: "pass", message: "Test verifier accepted the signature." }),
    }, { requireListCertificateMatch: true });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "signature.list_certificate_exact_match",
      status: "fail",
    }));
  });

  it("validates XAdES Baseline B, exact Annex H.4 constraints, signer metadata, and explicit signer trust independently", async () => {
    const xml = await xadesFixture();
    const document = parseXml(xml).document;
    if (!document) throw new Error("Fixture must parse.");

    const result = await assessSignature(xml, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({ status: "pass", message: "Test verifier accepted all references and the signature value." }),
    }, {
      requireBaselineB: true,
      requireAnnexH4: true,
      schemeTerritory: "EU",
      schemeOperatorNames: ["WE BUILD Test"],
      trustedSignerFingerprintsSha256: ["3f3244d1d4a6d4c0c5539761560e52afab8072f389239c69f5d2e3803228b372"],
    });

    const expectedPasses = [
      "signature.xades_baseline_b.structure",
      "signature.xades_baseline_b.mandatory_elements",
      "signature.xades_baseline_b.signing_time",
      "signature.xades_baseline_b.signing_certificate_reference",
      "signature.xades_baseline_b.data_object_formats",
      "signature.xades_baseline_b.reference_digests",
      "signature.xades_baseline_b.prohibited_legacy_properties",
      "signature.annex_h4.enveloped",
      "signature.annex_h4.document_reference",
      "signature.annex_h4.transforms",
      "signature.annex_h4.canonicalization",
      "signature.cryptographic_verification_result",
      "signature.signing_certificate_validity",
      "signature.signer_subject.country",
      "signature.signer_subject.organization",
      "signature.signer_trust",
    ];
    for (const id of expectedPasses) {
      expect(result.checks).toContainEqual(expect.objectContaining({ id, status: "pass" }));
    }
  });

  it("reports malformed H.4/XAdES evidence separately from certificate validity, subject matching, and trust", async () => {
    const validXml = await xadesFixture();
    const xml = validXml
      .replace(
        '<ds:DigestValue>PzJE0dSm1MDFU5dhVg5Sr6uAcvOJI5xp9dLjgDIos3I=</ds:DigestValue>',
        '<ds:DigestValue>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=</ds:DigestValue>',
      )
      .replace(
        '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>\n          <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>',
        '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>\n          <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>',
      )
      .replace("2026-07-21T12:00:00Z", "2026-07-21T12:00:00+00:00")
      .replace("<xades:Cert>", '<xades:Cert URI="https://example.test/certificate">')
      .replace("<xades:MimeType>application/xml</xades:MimeType>", "")
      .replace("</xades:SignedSignatureProperties>", "<xades:SignerRole/></xades:SignedSignatureProperties>");
    const document = parseXml(xml).document;
    if (!document) throw new Error("Fixture must parse.");

    const result = await assessSignature(xml, document, new Date("2037-08-01T00:00:00Z"), {
      verifier: () => ({ status: "fail", message: "Test verifier rejected a reference digest." }),
    }, {
      requireBaselineB: true,
      requireAnnexH4: true,
      schemeTerritory: "DE",
      schemeOperatorNames: ["Different Operator"],
      trustedSignerFingerprintsSha256: ["00".repeat(32)],
    });

    for (const id of [
      "signature.xades_baseline_b.signing_certificate_reference",
      "signature.xades_baseline_b.signing_time",
      "signature.xades_baseline_b.data_object_formats",
      "signature.xades_baseline_b.prohibited_legacy_properties",
      "signature.annex_h4.transforms",
      "signature.cryptographic_verification_result",
      "signature.signing_certificate_validity",
      "signature.signer_subject.country",
      "signature.signer_subject.organization",
      "signature.signer_trust",
    ]) {
      expect(result.checks).toContainEqual(expect.objectContaining({ id, status: "fail" }));
    }
    expect(result.checks).toContainEqual(expect.objectContaining({ id: "signature.xades_baseline_b.structure", status: "pass" }));
  });

  it("does not infer signer trust from an embedded certificate", async () => {
    const xml = await xadesFixture();
    const document = parseXml(xml).document;
    if (!document) throw new Error("Fixture must parse.");
    const result = await assessSignature(xml, document, new Date("2026-08-01T00:00:00Z"), {
      verifier: () => ({ status: "pass", message: "Test verifier accepted the signature." }),
    }, { requireBaselineB: true });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "signature.signer_trust",
      status: "not_checked",
      message: expect.stringContaining("evidence, not a trust decision"),
    }));
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "signature.annex_h4.transforms",
      status: "not_applicable",
    }));
  });
});

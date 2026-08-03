import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { certificateFingerprintSha256 } from "../src/certs.js";
import { LotlParseError, parseLotl, parseLotlJson } from "../src/lotl.js";

describe("parseLotlJson", () => {
  it("counts all PointersToOtherLoTE entries", async () => {
    const text = await readFile("test/fixtures/lotl.json", "utf8");
    const parsed = parseLotlJson(text);
    expect(parsed.summary.pointerCount).toBe(3);
    expect(parsed.summary.uniqueLocationCount).toBe(3);
    expect(parsed.pointers.map((p) => p.location)).toEqual([
      "https://example.test/tl.xml",
      "https://example.test/lote.json",
      "https://example.test/unreachable.xml",
    ]);
  });

  it("extracts declared type and MIME type from LoTEQualifiers", async () => {
    const text = await readFile("test/fixtures/lotl.json", "utf8");
    const parsed = parseLotlJson(text);

    expect(parsed.pointers[0]?.declared).toMatchObject({
      loteType: "xml",
      mimeType: "application/xml",
    });
    expect(parsed.pointers[1]?.declared).toMatchObject({
      loteType: "json",
      mimeType: "application/json",
    });
  });
});

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
      loteType:
        "http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUlistofthelists",
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
    const parsed = parseLotl(
      await readFile("test/fixtures/lotl.json", "utf8"),
    );
    expect(parsed.format).toBe("json");
    expect(parsed.summary.pointerCount).toBe(3);
  });

  it("accepts a matching non-EU community list-of-lists type", async () => {
    const xml = (
      await readFile("test/fixtures/lotl-ts119612.xml", "utf8")
    )
      .replaceAll("EUlistofthelists", "GCClistofthelists")
      .replace(
        "<SchemeTerritory>EU</SchemeTerritory>",
        "<SchemeTerritory>GCC</SchemeTerritory>",
      );
    expect(parseLotl(xml).summary.loteType).toContain("GCClistofthelists");
  });

  it.each([
    ["EUgeneric", "EU", "not an ETSI list-of-lists type"],
    ["GCClistofthelists", "AP", "not an ETSI list-of-lists type"],
  ] as const)(
    "rejects invalid XML LoTL type %s for %s",
    async (suffix, territory, message) => {
      const xml = (
        await readFile("test/fixtures/lotl-ts119612.xml", "utf8")
      )
        .replace("EUlistofthelists", suffix)
        .replace(
          "<SchemeTerritory>EU</SchemeTerritory>",
          `<SchemeTerritory>${territory}</SchemeTerritory>`,
        );
      expect(() => parseLotl(xml)).toThrow(message);
    },
  );

  it("rejects malformed XML LoTL structure", async () => {
    const fixture = await readFile(
      "test/fixtures/lotl-ts119612.xml",
      "utf8",
    );
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
});

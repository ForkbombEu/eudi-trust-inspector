import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit, runAuditFromContent } from "../src/audit.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("XML LoTL audit inputs", () => {
  it("audits ETSI TS 119 612 XML supplied as request content", async () => {
    const content = await readFile("test/fixtures/lotl-ts119612.xml", "utf8");

    const result = await runAuditFromContent(content, {
      concurrency: 1,
      timeoutMs: 1_000,
      strict: false,
      includeJsonLoteChecks: true,
      fetch: false,
    }, "0.0.0-test");

    expect(result.json.input).toMatchObject({ source: "request-body", kind: "xml" });
    expect(result.json.summary).toMatchObject({ totalPointers: 1, fetched: 0 });
    expect(result.json.results[0]).toMatchObject({
      location: "https://example.test/member-state.xml",
      fetch: { attempted: false },
    });
  });

  it("audits an ETSI TS 119 612 XML file and writes reports", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "eudi-trust-inspector-xml-lotl-"));
    temporaryDirectories.push(outDir);

    const report = await runAudit({
      input: "test/fixtures/lotl-ts119612.xml",
      outDir,
      concurrency: 1,
      timeoutMs: 1_000,
      strict: false,
      includeJsonLoteChecks: true,
      fetch: false,
      contextual: false,
    }, "0.0.0-test");

    expect(report.input).toMatchObject({ source: "test/fixtures/lotl-ts119612.xml", kind: "file" });
    expect(report.summary.totalPointers).toBe(1);
    await expect(readFile(join(outDir, "report.json"), "utf8")).resolves.toContain('"totalPointers": 1');
    await expect(readFile(join(outDir, "report.md"), "utf8")).resolves.toContain("https://example.test/member-state.xml");
  });
});

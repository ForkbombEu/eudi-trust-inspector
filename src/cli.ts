#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { runAudit } from "./audit.js";
import { referenceSourceIds, resolveReferenceSource } from "./referenceSources.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command()
  .name("we-build-tl-audit")
  .description("Audit trusted lists referenced by a JSON or ETSI TS 119 612 XML LoTL.")
  .version(pkg.version)
  .option("--input <path-or-url>", "Local path or URL to a JSON or XML LoTL.")
  .option("--reference-source <id>", `Named reference source (${referenceSourceIds().join(", ")}).`)
  .option("--out-dir <dir>", "Output directory.", "./tl-audit-output")
  .option("--concurrency <n>", "Concurrent referenced artifact fetches.", parsePositiveInteger, 4)
  .option("--timeout-ms <n>", "Fetch timeout in milliseconds.", parsePositiveInteger, 15_000)
  .option("--xsd <path>", "Override automatic ETSI TS 119 612 schema selection with a local XSD.")
  .option("--strict", "Failed mandatory checks make XML artifact non_conformant.", false)
  .option("--include-json-lote-checks", "Deprecated compatibility option; local JSON LoTE checks always run.", false)
  .option("--rpac-chain <path>", "Optional PEM, base64, x5c JSON, or JSON certificate-array RPAC/WRPAC chain.")
  .option("--contextual", "Opt in to bounded TL/LoTE pointer, distribution, archive, and supply-point dereferencing.", false)
  .option("--prior-lote <path>", "Optional prior TL or LoTE artifact for sequence/history evidence.")
  .option("--generate-negative-fixtures", "Write negative fixture descriptors under artifacts/generated-fixtures/.", false)
  .option("--no-fetch", "Parse LoTL only and report referenced URLs without fetching.")
  .parse();

const opts = program.opts<{
  input: string;
  referenceSource?: string;
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
  generateNegativeFixtures: boolean;
}>();

const input = resolveInput(opts.input, opts.referenceSource);

try {
  const report = await runAudit(
    {
      input,
      outDir: opts.outDir,
      concurrency: opts.concurrency,
      timeoutMs: opts.timeoutMs,
      xsd: opts.xsd,
      strict: opts.strict,
      includeJsonLoteChecks: opts.includeJsonLoteChecks,
      fetch: opts.fetch,
      rpacChain: opts.rpacChain,
      contextual: opts.contextual,
      priorLote: opts.priorLote,
      generateNegativeFixtures: opts.generateNegativeFixtures,
    },
    pkg.version,
  );
  console.log(`Wrote ${opts.outDir}/report.json and ${opts.outDir}/report.md`);
  console.log(`Pointers: ${report.summary.totalPointers}; fetched: ${report.summary.fetched}; failed: ${report.summary.fetchFailed}`);
  if (opts.generateNegativeFixtures) console.log("Wrote artifacts/generated-fixtures/negative-fixture-descriptors.{json,md}");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function resolveInput(input: string | undefined, referenceSourceId: string | undefined): string {
  if (input && referenceSourceId) {
    program.error("Use either --input or --reference-source, not both.");
  }
  if (input) return input;
  if (!referenceSourceId) {
    program.error("Missing required option: provide --input <path-or-url> or --reference-source <id>.");
    throw new Error("Unreachable after Commander error.");
  }
  const referenceSource = resolveReferenceSource(referenceSourceId);
  if (!referenceSource) {
    program.error(`Unknown reference source '${referenceSourceId}'. Available sources: ${referenceSourceIds().join(", ")}.`);
    throw new Error("Unreachable after Commander error.");
  }
  return referenceSource.url;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer, got ${value}`);
  }
  return parsed;
}

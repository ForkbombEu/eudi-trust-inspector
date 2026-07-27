# Development Specifications

## Runtime and tooling

- TypeScript on Node.js 20+.
- ESM package (`"type": "module"`) built with TypeScript using `NodeNext` module and resolution settings, ES2022 target, strict type checking, and output in `dist/`.
- npm is the package manager (`package-lock.json`).
- The CLI entry point is `dist/cli.js` (`we-build-tl-audit`).
- Fastify provides the HTTP API; its routes, schemas, OpenAPI serving, and UI are under `src/api/`. The OpenAPI UI uses Stoplight Elements.
- Key libraries include `@xmldom/xmldom`, `xpath`, `ajv`, `commander`, `yaml`, and `dotenv`.

Use explicit TypeScript types for public report objects, API request/response bodies, and durable schemas. Avoid `any` in new public interfaces except at a justified compatibility boundary.

## Architecture and source layout

Assessment functions are shared by the CLI and API; API code must reuse the core functions rather than shelling out to the CLI. API assessment operations are POST endpoints, are documented in OpenAPI, and use stable JSON schemas. API behaviour matches CLI behaviour unless explicitly documented otherwise.

The source tree is organized around:

- `src/input.ts`, `src/fetcher.ts`, `src/detect.ts`, and `src/lotl.ts` for input loading, bounded fetching, detection, and LoTL parsing;
- `src/xml/` for XML parsing, XPath, ETSI TS 119 612 checks, signatures, XAdES, XML Schema, and XML security helpers;
- `src/json/` for LoTE, JAdES, and ETSI TS 119 602 JSON-schema checks;
- `src/standards/` for ETSI TS 119 602 and ETSI TS 119 612 requirements, coverage, schemas, contexts, and semantic checks;
- `src/eudi/` for EUDI roles, Access CA/RPAC chains, and fixture readiness;
- `src/fcaf/` for FCAF `trusted_authorities` fixture readiness;
- `src/profiles/` for WE BUILD and TS 119 612 reference profiles;
- `src/report/` for JSON and Markdown rendering; and
- `src/api/` for the Fastify server, routes, schemas, OpenAPI, docs UI, and API assets.

The canonical output is an assessment result comprising a machine-readable JSON report, a human-readable Markdown report, optional fetched evidence artifacts, and optional API/OpenAPI responses.

## Commands and validation

```bash
npm test
npm run build
npm run dev:api
npm run api
```

Additional optional/manual reference workflows are exposed as `npm run reference-smoke`, `npm run eudi-ri-tlp-fixture-readiness`, `npm run reference-smoke-run`, and `npm run package-reference-smoke`. Live-network checks remain outside the normal test suite.

Keep automated tests deterministic and use mocked network failures where applicable. Maintain focused coverage for input loading, LoTL pointers, artifact detection, XML and JSON/LoTE checks, WE BUILD and EUDI fixtures, certificate chains, report rendering, API routes, OpenAPI contracts, invalid input, and network failures.

## Repository constraints

- Use small deterministic fixtures in `test/fixtures/`; do not commit large live Trusted List snapshots unless intentionally curated as small test fixtures.
- Generated audit outputs, fetched live artifacts, `dist/`, `node_modules/`, caches, local `.env` files, secrets, and temporary debugging files are not source artifacts.
- Use `artifacts/` for reviewable repository-local generated artifacts rather than `/tmp`.
- New durable commands belong in `package.json` scripts. Shell scripts use `set -euo pipefail`.

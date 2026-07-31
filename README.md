# EUDI Trust Inspector

## Intro

EUDI Trust Inspector is a deterministic CLI, API, and browser UI for assessing EUDI and WE BUILD trusted-list inputs. It helps operators distinguish parsed facts, implemented technical checks, evidence limits, and unsupported claims without presenting itself as a legal conformance authority.

## Technical specs

TypeScript on Node.js with Fastify for the HTTP adapter. The assessment core is reused by the CLI and API; OpenAPI 3.1 is authored in YAML and served as YAML or derived JSON. XML, JSON LoTE/LoTL, JAdES, certificate-chain, and fixture-readiness checks remain explicit assessment domains.

## HOW to run

```sh
npm ci
npm test
npm run build
npm run api
```

The API listens on `http://127.0.0.1:3000` by default. Use `npm run dev:api` for source-mode development. Copy `.env-example` to `.env` to set `HOST`, `PORT`, `PUBLIC_BASE_URL`, CORS, and audit defaults.

## Quick GUI guide

The homepage introduces the assessment in a compact hero followed by the audit form. Its header links to the API documentation, raw OpenAPI document, and project repository.

### LoTL

Provide a LoTL URL or upload its JSON. The result groups findings by fetched TrustedList and separates pass, warning, failure, and not-final states. Long findings lists expand the page, while JSON and Markdown output remain bounded scrollable panels.

### TrustedList XML/JSON

Provide a TrustedList URL, upload XML/JSON/JWS, or paste content. The UI renders findings, the complete JSON result, and available Markdown.

## CLI Examples

| Function                     | Example                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Audit local LoTL             | `node dist/cli.js --input ./list_of_trusted_lists.json --out-dir ./audit-output --concurrency 4 --timeout-ms 15000`                 |
| Audit a URL                  | `node dist/cli.js --input https://webuild-consortium.github.io/wp4-trust-group/list_of_trusted_lists.json --out-dir ./audit-output` |
| Use a named reference source | `node dist/cli.js --reference-source we-build-lotl-json --out-dir ./audit-output`                                                   |

## API Examples

| Function                 | Example                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health                   | `curl http://127.0.0.1:3000/healthz`                                                                                                                                                     |
| Audit a LoTL URL         | `curl -X POST http://127.0.0.1:3000/api/v1/audit/url -H 'content-type: application/json' -d '{"url":"https://webuild-consortium.github.io/wp4-trust-group/list_of_trusted_lists.json"}'` |
| Assess a TrustedList URL | `curl -X POST http://127.0.0.1:3000/api/v1/artifact/assess-url -H 'content-type: application/json' -d '{"url":"https://example.org/trusted-list.xml"}'`                                  |
| Parse a LoTL             | `curl -X POST http://127.0.0.1:3000/api/v1/lotl/parse -H 'content-type: application/json' -d '{"lotl":{"LoTE":{"ListAndSchemeInformation":{"PointersToOtherLoTE":[]}}}}'`                |

Interactive documentation is at `/docs`; `/openapi.yaml` is the authoritative machine-readable document and `/openapi.json` is derived from it.

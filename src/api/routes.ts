import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import {
  assessArtifactContent,
  assessArtifactUrl,
  runAuditFromContent,
  runAuditFromJson,
  runAuditFromUrl,
} from "../audit.js";
import { assessCertificateChain } from "../eudi/certificateChain.js";
import type { EudiTrustRole } from "../eudi/roles.js";
import { isUrl } from "../input.js";
import { parseLotl } from "../lotl.js";
import { renderMarkdownReport } from "../report/markdownReport.js";
import type {
  AuditReport,
  TrustedListAuditResult,
  Ts119602ContextOptions,
} from "../types.js";
import type { ApiRuntimeConfig } from "./config.js";
import { requestBaseUrl } from "./config.js";
import { renderDocsHtml } from "./docs.js";
import { auditUiScript, renderAuditUiHtml } from "./auditUi.js";
import { loadOpenApiJson, loadOpenApiYaml } from "./openapi.js";
import {
  artifactAssessUrlSchema,
  artifactAssessContentSchema,
  auditJsonSchema,
  auditLotlSchema,
  auditUrlSchema,
  certificateChainSchema,
  defaultArtifactOptions,
  defaultAuditOptions,
  lotlParseSchema,
  markdownReportSchema,
} from "./schemas.js";

export interface RouteOptions {
  version: string;
  config: ApiRuntimeConfig;
}

interface AuditUrlBody {
  url: string;
  options?: Partial<ReturnType<typeof defaultAuditOptions>>;
  context?: Ts119602ContextOptions;
}

interface AuditJsonBody {
  lotl: unknown;
  options?: Partial<ReturnType<typeof defaultAuditOptions>>;
  context?: Ts119602ContextOptions;
}

interface AuditLotlBody {
  url?: string;
  lotl?: unknown;
  content?: string;
  options?: Partial<ReturnType<typeof defaultAuditOptions>>;
  rpacChain?: string | string[];
  context?: Ts119602ContextOptions;
}

interface LotlParseBody {
  lotl: unknown;
}

interface ArtifactAssessUrlBody {
  url: string;
  declared?: Partial<TrustedListAuditResult["declared"]>;
  options?: Partial<ReturnType<typeof defaultArtifactOptions>>;
  context?: Ts119602ContextOptions;
}

interface ArtifactAssessContentBody {
  content: string;
  source?: string;
  contentType?: string;
  declared?: Partial<TrustedListAuditResult["declared"]>;
  options?: Partial<ReturnType<typeof defaultArtifactOptions>>;
  context?: Ts119602ContextOptions;
}

interface CertificateChainBody {
  chain: string | string[];
  format?: "pem" | "der_base64" | "x5c";
  trustAnchors?: string[];
  declaredRole?: EudiTrustRole;
}

interface MarkdownReportBody {
  report: AuditReport;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderAuditUiHtml();
  });

  app.get("/assets/audit-ui.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8");
    return readFile(new URL("./assets/audit-ui.css", import.meta.url), "utf8");
  });

  app.get("/assets/style.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8");
    return readFile(new URL("./assets/style.css", import.meta.url), "utf8");
  });

  app.get("/assets/audit-ui.js", async (_request, reply) => {
    reply.type("application/javascript; charset=utf-8");
    return auditUiScript;
  });

  app.get("/assets/credimi_logo.svg", async (_request, reply) => {
    reply.type("image/svg+xml");
    return readFile(
      new URL("./assets/credimi_logo.svg", import.meta.url),
      "utf8",
    );
  });

  app.get("/assets/credimi_logo_negative.svg", async (_request, reply) => {
    reply.type("image/svg+xml");
    return readFile(
      new URL("./assets/credimi_logo_negative.svg", import.meta.url),
      "utf8",
    );
  });

  app.get("/assets/credimi_logo-transp.svg", async (_request, reply) => {
    reply.type("image/svg+xml");
    return readFile(
      new URL("./assets/credimi_logo-transp.svg", import.meta.url),
      "utf8",
    );
  });

  app.get("/assets/credimi_logo-transp_white.svg", async (_request, reply) => {
    reply.type("image/svg+xml");
    return readFile(
      new URL("./assets/credimi_logo-transp_white.svg", import.meta.url),
      "utf8",
    );
  });

  app.get("/favicon.svg", async (_request, reply) => {
    reply.type("image/svg+xml");
    return readFile(
      new URL("./assets/credimi_logo.svg", import.meta.url),
      "utf8",
    );
  });

  app.get("/healthz", async () => ({
    ok: true,
    name: "we-build-tl-audit",
    version: options.version,
  }));

  app.get("/openapi.yaml", async (request, reply) => {
    reply.type("application/yaml");
    return loadOpenApiYaml(requestBaseUrl(request.headers, options.config));
  });

  app.get("/openapi.json", async (request) =>
    loadOpenApiJson(requestBaseUrl(request.headers, options.config)),
  );

  app.get("/docs", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderDocsHtml();
  });

  app.post<{ Body: AuditUrlBody }>(
    "/api/v1/audit/url",
    { schema: auditUrlSchema },
    async (request) => {
      if (!isUrl(request.body.url)) {
        throw request.server.httpErrors.badRequest("Invalid URL.", {
          code: "invalid_url",
        });
      }
      const result = await runAuditFromUrl(
        request.body.url,
        {
          ...defaultAuditOptions(
            request.body.options,
            options.config.auditDefaults,
          ),
          context: request.body.context,
        },
        options.version,
      );
      return {
        report: result.json,
        markdown: result.markdown,
      };
    },
  );

  app.post<{ Body: AuditJsonBody }>(
    "/api/v1/audit/json",
    { schema: auditJsonSchema },
    async (request) => {
      const result = await runAuditFromJson(
        request.body.lotl,
        {
          ...defaultAuditOptions(
            request.body.options,
            options.config.auditDefaults,
          ),
          context: request.body.context,
        },
        options.version,
      );
      return {
        report: result.json,
        markdown: result.markdown,
      };
    },
  );

  app.post<{ Body: AuditLotlBody }>(
    "/api/audit/lotl",
    { schema: auditLotlSchema },
    async (request) => {
      const result = await auditLotl(request.body, options, request.server);
      return { report: result.json, markdown: result.markdown };
    },
  );

  app.post<{ Body: LotlParseBody }>(
    "/api/v1/lotl/parse",
    { schema: lotlParseSchema },
    async (request) => {
      const parsed = parseLotl(lotlText(request.body.lotl));
      return {
        summary: parsed.summary,
        pointers: parsed.pointers.map((pointer) => ({
          index: pointer.index,
          location: pointer.location,
          declared: pointer.declared,
        })),
      };
    },
  );

  app.post<{ Body: ArtifactAssessUrlBody }>(
    "/api/v1/artifact/assess-url",
    { schema: artifactAssessUrlSchema },
    async (request) => {
      if (!isUrl(request.body.url)) {
        throw request.server.httpErrors.badRequest("Invalid URL.", {
          code: "invalid_url",
        });
      }
      const artifactOptions = defaultArtifactOptions(
        request.body.options,
        options.config.auditDefaults,
      );
      const result = await assessArtifactUrl({
        url: request.body.url,
        declared: request.body.declared,
        timeoutMs: artifactOptions.timeoutMs,
        strict: artifactOptions.strict,
        includeJsonLoteChecks: artifactOptions.includeJsonLoteChecks,
        context: request.body.context,
      });
      return { result };
    },
  );

  app.post<{ Body: ArtifactAssessContentBody }>(
    "/api/audit/artifact",
    { schema: artifactAssessContentSchema },
    async (request) => {
      const artifactOptions = defaultArtifactOptions(
        request.body.options,
        options.config.auditDefaults,
      );
      const result = await assessArtifactContent({
        content: request.body.content,
        source: request.body.source,
        contentType: request.body.contentType,
        declared: request.body.declared,
        ...artifactOptions,
        context: request.body.context,
      });
      return { result };
    },
  );

  app.post<{ Body: CertificateChainBody }>(
    "/api/audit/certificate-chain",
    { schema: certificateChainSchema },
    async (request) => ({
      assessment: assessCertificateChain(request.body),
    }),
  );

  app.post<{ Body: AuditLotlBody }>(
    "/api/audit/fixture-readiness",
    { schema: auditLotlSchema },
    async (request) => {
      const result = await auditLotl(request.body, options, request.server);
      return {
        fixtureReadiness: result.json.fixtureReadiness,
        fcafTrustedAuthorities: result.json.fcafTrustedAuthorities,
        negativeFixtureDescriptors: result.json.negativeFixtureDescriptors,
      };
    },
  );

  app.post<{ Body: MarkdownReportBody }>(
    "/api/v1/report/markdown",
    { schema: markdownReportSchema },
    async (request) => ({
      markdown: renderMarkdownReport(request.body.report),
    }),
  );

  app.post<{ Body: MarkdownReportBody }>(
    "/api/reports/markdown",
    { schema: markdownReportSchema },
    async (request) => ({
      markdown: renderMarkdownReport(request.body.report),
    }),
  );
}

async function auditLotl(
  body: AuditLotlBody,
  routeOptions: RouteOptions,
  app: FastifyInstance,
) {
  const auditOptions = {
    ...defaultAuditOptions(body.options, routeOptions.config.auditDefaults),
    rpacChain: body.rpacChain,
    context: body.context,
  };
  if (body.url !== undefined) {
    if (!isUrl(body.url))
      throw app.httpErrors.badRequest("Invalid URL.", { code: "invalid_url" });
    return runAuditFromUrl(body.url, auditOptions, routeOptions.version);
  }
  if (body.content !== undefined) {
    return runAuditFromContent(body.content, auditOptions, routeOptions.version);
  }
  return runAuditFromJson(body.lotl, auditOptions, routeOptions.version);
}

function lotlText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

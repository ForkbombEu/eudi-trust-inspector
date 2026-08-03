import { createRequire } from "node:module";
import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { LotlParseError } from "../lotl.js";
import { loadApiConfig } from "./config.js";
import { registerRoutes } from "./routes.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

interface ApiError {
  code?: string;
  statusCode?: number;
  validation?: unknown;
}

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const config = loadApiConfig();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: config.corsOrigin });

  app.decorate("httpErrors", {
    badRequest(message: string, details?: unknown) {
      const error = new Error(message) as Error & ApiError;
      error.statusCode = 400;
      error.code = details && typeof details === "object" && "code" in details
        ? String((details as { code: unknown }).code)
        : "invalid_request";
      return error;
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    const apiError = error as Error & ApiError;
    if (apiError.validation) {
      reply.status(400).send({
        error: {
          code: "invalid_request",
          message: "Invalid request body.",
          details: apiError.validation,
        },
      });
      return;
    }

    if (error instanceof LotlParseError) {
      reply.status(400).send({
        error: {
          code: error.format === "unknown" ? "invalid_lotl" : `invalid_lotl_${error.format}`,
          message: apiError.message,
        },
      });
      return;
    }

    if (error instanceof SyntaxError) {
      reply.status(400).send({
        error: {
          code: "invalid_lotl_json",
          message: apiError.message,
        },
      });
      return;
    }

    if (apiError.statusCode && apiError.statusCode >= 400 && apiError.statusCode < 500) {
      reply.status(apiError.statusCode).send({
        error: {
          code: apiError.code ?? "invalid_request",
          message: apiError.message,
        },
      });
      return;
    }

    reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Unexpected internal error.",
      },
    });
  });

  await registerRoutes(app, { version: pkg.version, config });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadApiConfig();
  const app = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
    console.log(`we-build-tl-audit API listening on http://${config.host}:${config.port}`);
  } catch (error) {
    app.log.error(error instanceof Error ? error : { error: String(error) });
    process.exitCode = 1;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    httpErrors: {
      badRequest(message: string, details?: unknown): Error;
    };
  }
}

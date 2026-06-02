// Structured logger configuration for Fastify. Fastify ships Pino as its
// default logger; this module just supplies the LoggerOptions that wire
// up redaction, level selection, and JSON-vs-pretty formatting.
//
// Usage: `import { loggerOptions } from "./logger"; Fastify({ logger: loggerOptions() });`

import type { FastifyServerOptions } from "fastify";

const PROD_LEVEL = process.env.LOG_LEVEL ?? "info";
const DEV_LEVEL = process.env.LOG_LEVEL ?? "debug";
const SERVICE_NAME = process.env.SERVICE_NAME ?? "api";

// Redact request/response headers and any field whose KEY name looks
// secret-shaped. Pino dot-notation paths are evaluated on the log
// record. We cover the standard Fastify shapes plus anything that
// might appear inside our domain payloads.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.headers['x-siwe-signature']",
  "res.headers['set-cookie']",
  "headers.authorization",
  "headers.cookie",
  "*.privateKey",
  "*.private_key",
  "*.secret",
  "*.password",
  "*.token",
  "*.jwt",
  "*.signature",
  "*.mnemonic",
  "*.apiKey",
  "*.api_key",
];

export function loggerOptions(): FastifyServerOptions["logger"] {
  const isProd = process.env.NODE_ENV === "production";
  const base: NonNullable<FastifyServerOptions["logger"]> = {
    level: isProd ? PROD_LEVEL : DEV_LEVEL,
    base: {
      service: SERVICE_NAME,
      env: process.env.NODE_ENV ?? "development",
    },
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
  };

  // Dev convenience: pretty-print only when explicitly requested. The
  // package is intentionally not a hard dependency, so tests and CI
  // keep JSON logs unless LOG_PRETTY=1 is set in a local shell.
  if (!isProd && process.env.NODE_ENV !== "test" && process.env.LOG_PRETTY === "1") {
    base.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service,env",
      },
    };
  }

  return base;
}

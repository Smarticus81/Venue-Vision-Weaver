import type { NextFunction, Request, Response } from "express";
import type { CorsOptions } from "cors";

function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origins = new Set<string>();
  const candidates = [
    env.APP_BASE_URL,
    env.PUBLIC_APP_URL,
    env.RAILWAY_STATIC_URL,
    env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
      : undefined,
    ...(env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) return true;
  if (env.NODE_ENV !== "production") return true;
  return allowedCorsOrigins(env).has(origin);
}

export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      callback(null, isCorsOriginAllowed(origin, env));
    },
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
}

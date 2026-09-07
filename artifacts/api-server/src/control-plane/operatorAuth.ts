import type { Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { clerkEnabled, fetchClerkUserEmail } from "../lib/orgAuth.js";

/**
 * The control plane is a platform-operator surface, not a venue-owner one.
 * Operators are the Clerk-authenticated users whose emails appear in
 * CONTROL_PLANE_OPERATOR_EMAILS (comma-separated). Outside production, any
 * signed-in user is treated as an operator when the list is unset so local
 * development works out of the box; in production an explicit list is
 * mandatory.
 */
export function operatorEmails(): string[] {
  return (process.env.CONTROL_PLANE_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export type OperatorContext = {
  email: string;
  clerkUserId: string;
};

export async function requireOperator(
  req: Request,
  res: Response,
): Promise<OperatorContext | null> {
  if (!clerkEnabled()) {
    res.status(503).json({
      error:
        "Authentication is not configured on this server (CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are both required).",
    });
    return null;
  }

  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }

  const email = await fetchClerkUserEmail(auth.userId);
  if (!email) {
    res.status(403).json({ error: "Could not resolve your account email." });
    return null;
  }

  const allowed = operatorEmails();
  if (allowed.length === 0) {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({
        error:
          "Control-plane operators are not configured. Set CONTROL_PLANE_OPERATOR_EMAILS to a comma-separated allowlist.",
      });
      return null;
    }
    return { email, clerkUserId: auth.userId };
  }

  if (!allowed.includes(email)) {
    res.status(403).json({ error: "You are not a control-plane operator." });
    return null;
  }

  return { email, clerkUserId: auth.userId };
}

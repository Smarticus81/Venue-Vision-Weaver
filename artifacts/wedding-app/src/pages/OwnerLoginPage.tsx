import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OwnerLoginPage() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    const nextPath = safeNextPath(params.get("next"));
    if (!token) {
      setError("Login link is missing a token.");
      return;
    }
    fetch("/api/owners/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Login link is invalid or expired.");
        const session = await fetch("/api/owners/session").then((r) => r.json());
        const firstSlug = session?.venues?.[0]?.slug;
        setLocation(nextPath ?? (firstSlug ? `/dashboard/${firstSlug}` : "/"));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not sign in."));
  }, [setLocation]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <Mail className="h-12 w-12 text-primary mb-4" />
        <h1 className="serif text-3xl mb-3">Link expired</h1>
        <p className="text-muted-foreground max-w-sm mb-6">{error}</p>
        <Button onClick={() => setLocation("/")} className="bg-primary text-primary-foreground">
          Request a new link
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-12 w-12 animate-spin text-primary" />
    </div>
  );
}

function safeNextPath(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

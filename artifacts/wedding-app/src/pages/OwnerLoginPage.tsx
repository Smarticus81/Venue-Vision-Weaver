import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { FrameTicks } from "@/components/motion";

export default function OwnerLoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isTokenExchange, setIsTokenExchange] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    if (!token) return;

    setIsTokenExchange(true);
    fetch("/api/owners/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Login link is invalid or expired.");
        setLocation("/dashboard");
      })
      .catch((err) => {
        setTokenError(err instanceof Error ? err.message : "Could not sign in.");
        // Drop the consumed token so a refresh shows the login form instead of re-failing.
        window.history.replaceState(null, "", window.location.pathname);
      })
      .finally(() => setIsTokenExchange(false));
  }, [setLocation]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/owners/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Invalid email or password.");
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "Could not sign in",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMagicLink = async () => {
    const ownerEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      toast({
        title: "Enter your email",
        description: "Use the owner email for your venue.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingLink(true);
    try {
      const res = await fetch("/api/owners/login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ownerEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not send login link.");
      }
      toast({
        title: "Check your inbox",
        description: "We sent a secure one-time sign-in link.",
      });
    } catch (err) {
      toast({
        title: "Could not send link",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingLink(false);
    }
  };

  if (isTokenExchange) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-rose" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="absolute top-0 w-full p-6 sm:p-10 flex items-center justify-between z-10">
        <GlimpseLogo href="/" />
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="mono-label inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </button>
      </header>

      <main className="grain flex-1 flex items-center justify-center p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,hsl(var(--rose)/0.08),transparent_70%)] pointer-events-none" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="relative bg-card p-8">
            <FrameTicks size={16} className="text-foreground/40" />

            <div className="mb-8">
              <p className="mono-label mb-4 text-rose">Venue dashboard</p>
              <h1 className="font-display text-3xl font-medium tracking-tight text-foreground">Owner login</h1>
              <p className="mt-2 text-muted-foreground font-light">
                Sign in to your venue dashboard
              </p>
            </div>

            {tokenError && (
              <p className="mono-label mb-6 normal-case tracking-normal text-red-400" role="alert">
                {tokenError}
              </p>
            )}

            <form onSubmit={handlePasswordLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="owner-email" className="mono-label text-muted-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="owner-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 pl-11 rounded-none border-input bg-background focus-visible:ring-ring"
                    placeholder="owner@venue.com"
                    data-testid="owner-login-email"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-password" className="mono-label text-muted-foreground">Password</Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="owner-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pl-11 rounded-none border-input bg-background focus-visible:ring-ring"
                    placeholder="Your password"
                    data-testid="owner-login-password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="rose"
                disabled={isSubmitting}
                className="w-full h-12 rounded-none font-medium mt-2"
                data-testid="owner-login-submit"
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign in <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>

            <div className="mt-8 flex flex-col gap-4">
              <div className="glimpse-divider">
                <span className="mono-label text-muted-foreground">Or</span>
              </div>
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={isSendingLink}
                className="mx-auto inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                data-testid="owner-magic-link"
              >
                {isSendingLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send sign-in link
              </button>
            </div>

            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => setLocation("/create-venue")}
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                data-testid="owner-create-account"
              >
                Create a new venue workspace
              </button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

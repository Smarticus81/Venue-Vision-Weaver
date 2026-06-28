import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
      .catch((err) =>
        setTokenError(err instanceof Error ? err.message : "Could not sign in."),
      )
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.95),transparent_32%),linear-gradient(135deg,#f7fbff_0%,#f8f1f5_46%,#eef7f4_100%)] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fbff_0%,#f6eef5_42%,#edf8f5_100%)] text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(255,255,255,0.9),transparent_26%),radial-gradient(circle_at_78%_20%,rgba(214,239,255,0.7),transparent_28%),radial-gradient(circle_at_52%_82%,rgba(255,231,240,0.7),transparent_30%)]" />
      <main className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-4 py-8 lg:grid-cols-[1fr_420px]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="hidden lg:block"
        >
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mb-10 inline-flex items-center gap-2 text-sm text-foreground/60 transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Glimpse
          </button>
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/45 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-2xl">
              <Sparkles className="h-4 w-4 text-sky-500" />
              Venue OS
            </div>
            <h1 className="text-6xl font-semibold leading-[0.95] tracking-normal text-[#111318]">
              Sign in. Send the vision. Book the tour.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-foreground/62">
              One clean workspace for venue teams turning tour interest into a
              personal gallery moment.
            </p>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="rounded-lg border border-white/65 bg-white/58 p-5 shadow-[0_30px_90px_rgba(31,41,55,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-3xl"
        >
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mb-6 inline-flex items-center gap-2 text-sm text-foreground/55 transition hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </button>

          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#111318] text-white shadow-lg">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h2 className="text-3xl font-semibold tracking-normal">Owner login</h2>
            <p className="mt-2 text-sm leading-6 text-foreground/58">
              Use the owner email and password for your venue dashboard.
            </p>
          </div>

          {tokenError && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50/85 px-4 py-3 text-sm text-rose-700">
              {tokenError}
            </div>
          )}

          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="owner-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/38" />
                <Input
                  id="owner-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 border-white/80 bg-white/64 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  placeholder="owner@venue.com"
                  data-testid="owner-login-email"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner-password">Password</Label>
              <Input
                id="owner-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 border-white/80 bg-white/64 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                placeholder="Your password"
                data-testid="owner-login-password"
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full bg-[#111318] text-white hover:bg-[#252932]"
              data-testid="owner-login-submit"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleMagicLink}
              disabled={isSendingLink}
              className="border-white/80 bg-white/45"
              data-testid="owner-magic-link"
            >
              {isSendingLink ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Email link
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLocation("/create-venue")}
              className="text-foreground/64 hover:text-foreground"
              data-testid="owner-create-account"
            >
              New venue
            </Button>
          </div>
        </motion.section>
      </main>
    </div>
  );
}

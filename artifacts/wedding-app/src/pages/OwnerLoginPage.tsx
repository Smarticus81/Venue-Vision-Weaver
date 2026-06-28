import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans selection:bg-gold selection:text-white flex flex-col">
      <header className="absolute top-0 w-full p-6 sm:p-10 flex items-center justify-between z-10">
        <GlimpseLogo href="/" />
        <Button variant="ghost" onClick={() => setLocation("/")} className="text-sm font-medium text-gray-500 hover:text-[#111111]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to site
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(194,163,107,0.05),transparent_50%)] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="bg-white rounded-3xl border border-gray-100 p-8 sm:p-10 shadow-xl shadow-black/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gold/20" />
            
            <div className="mb-8">
              <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf]">
                <LockKeyhole className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-[#111111]">Owner login</h1>
              <p className="mt-2 text-gray-500 font-light">
                Sign in to your venue dashboard
              </p>
            </div>

            {tokenError && (
              <div className="mb-6 rounded-xl border border-rose-100 bg-rose-50/50 p-4 text-sm text-rose-600">
                {tokenError}
              </div>
            )}

            <form onSubmit={handlePasswordLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="owner-email" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="owner-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 pl-11 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                    placeholder="owner@venue.com"
                    data-testid="owner-login-email"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-password" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Password</Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="owner-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pl-11 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                    placeholder="Your password"
                    data-testid="owner-login-password"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 bg-black hover:bg-gray-800 text-white rounded-full font-medium mt-2 transition-all shadow-md"
                data-testid="owner-login-submit"
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign in <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>

            <div className="mt-8 flex flex-col gap-3">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-100" />
                </div>
                <div className="relative flex justify-center text-xs uppercase font-semibold">
                  <span className="bg-white px-2 text-gray-400">Or</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleMagicLink}
                disabled={isSendingLink}
                className="w-full h-12 rounded-full font-medium border-gray-200 hover:bg-gray-50 text-gray-700 mt-2"
                data-testid="owner-magic-link"
              >
                {isSendingLink ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4 text-gray-400" />
                )}
                Send sign-in link
              </Button>
            </div>
            
            <div className="mt-8 text-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLocation("/create-venue")}
                className="text-gray-500 hover:text-[#111111]"
                data-testid="owner-create-account"
              >
                Create a new venue workspace
              </Button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

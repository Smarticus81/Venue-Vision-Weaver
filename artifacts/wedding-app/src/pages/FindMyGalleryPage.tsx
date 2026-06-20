import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, CheckCircle } from "lucide-react";
import { requestRecoveryEmail } from "@/lib/savedSessions";
import { CoupleSiteHeader } from "@/components/layout/CoupleSiteHeader";

export default function FindMyGalleryPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestRecoveryEmail(trimmed);
      if (result.error) {
        setError(result.error);
        setSubmitted(false);
      } else {
        setSubmitted(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <CoupleSiteHeader />

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-12 space-y-8">
        <h1 className="serif text-3xl text-center">Find my gallery</h1>
        {submitted ? (
          <div className="text-center space-y-4">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle className="h-7 w-7" />
            </div>
            <h2 className="serif text-2xl">Check your inbox</h2>
            <p className="text-muted-foreground">
              If a wedding gallery exists for{" "}
              <span className="text-foreground font-medium">{email}</span>, we just
              sent you an email with one-tap links to your gallery. For your privacy
              we never confirm whether an email is on file.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn't get it? Check spam. You can also try again in a few minutes - we
              rate-limit recovery requests to protect everyone's inbox.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setSubmitted(false);
                setEmail("");
              }}
              data-testid="find-gallery-reset"
            >
              Try another address
            </Button>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <p className="text-muted-foreground">
                Enter the email you used at the venue kiosk. We'll email you
                one-tap links to any wedding galleries we have on file.
              </p>
              <p className="text-xs text-muted-foreground/80">
                We never display a list of sessions in the browser; your galleries
                only appear in the email we send, keeping them private from
                anyone who might be looking over your shoulder.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  data-testid="find-gallery-email"
                  required
                  autoComplete="email"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full bg-primary text-primary-foreground"
                data-testid="find-gallery-submit"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Send Me My Links</>
                )}
              </Button>
            </form>

            {error && (
              <p className="text-destructive text-sm text-center" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

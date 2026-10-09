import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check } from "lucide-react";
import { requestRecoveryEmail } from "@/lib/recovery";
import { CoupleChrome } from "@/components/layout/CoupleChrome";
export default function FindMyGalleryPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <CoupleChrome venue={null} fallbackName="Find my gallery">
      <section className="cp-message" aria-live="polite">
        <p className="eyebrow">Find my gallery</p>
        <h1>Get your gallery link again.</h1>
        <p>
          Enter the email you used when you made your gallery. We’ll send your private links to that address.
        </p>
        {submitted ? (
          <>
            <h2 className="cp-recover__done">
              <Check className="text-success" aria-hidden /> Check your inbox
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If a gallery is linked to <strong>{email}</strong>, you’ll receive
              an email with your links. Check your spam folder too.
            </p>
            <p className="caption">
              For your privacy, we don’t confirm whether an address has a
              gallery.
            </p>
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => setSubmitted(false)}
              data-testid="find-gallery-reset"
            >
              Try another address
            </Button>
          </>
        ) : (
          <>
            <form
              className="cp-recover"
              onSubmit={async (e) => {
                e.preventDefault();
                setLoading(true);
                setError(null);
                try {
                  const result = await requestRecoveryEmail(email);
                  if (result.error || !result.accepted)
                    setError(
                      result.error ||
                        "Your request could not be completed. Please try again.",
                    );
                  else setSubmitted(true);
                } catch {
                  setError("Check your connection and try again.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <label htmlFor="recovery-email">Email address</label>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading}
                data-testid="find-gallery-email"
                aria-invalid={!!error}
                aria-describedby={error ? "recovery-error" : undefined}
              />
              <Button
                className="w-full"
                disabled={loading || !email.trim()}
                data-testid="find-gallery-submit"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" /> Sending your request…
                  </>
                ) : (
                  "Email my gallery links"
                )}
              </Button>
              {error && (
                <p
                  id="recovery-error"
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {error} Your email is still here.
                </p>
              )}
            </form>
            <p className="caption">
              Only you receive the links. No gallery list is shown here.
            </p>
          </>
        )}
      </section>
    </CoupleChrome>
  );
}

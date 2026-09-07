import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, Check } from "lucide-react";
import { requestRecoveryEmail } from "@/lib/savedSessions";
import { FormLayout } from "@/components/layout/SiteChrome";
export default function FindMyGalleryPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormLayout
      label="Your wedding, revisited"
      title="Your glimpse is waiting."
      description="Find the day you imagined. We’ll send a private link to the email you used to create your gallery."
    >
      <div aria-live="polite">
        {submitted ? (
          <>
            <Check className="text-primary mb-4" />
            <h2>Check your inbox</h2>
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
            <Mail className="text-primary mb-4" />
            <h2>Find my gallery</h2>
            <form
              className="space-y-4"
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
      </div>
    </FormLayout>
  );
}

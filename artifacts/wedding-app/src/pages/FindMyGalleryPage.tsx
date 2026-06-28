import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, CheckCircle, Images, ArrowLeft } from "lucide-react";
import { requestRecoveryEmail } from "@/lib/savedSessions";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

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
    <div className="min-h-screen bg-white text-[#111111] font-sans selection:bg-gold selection:text-white flex flex-col">
      <header className="absolute top-0 w-full p-6 sm:p-10 flex items-center justify-between z-10">
        <GlimpseLogo href="/couple" />
        <Button variant="ghost" onClick={() => setLocation("/couple")} className="text-sm font-medium text-gray-500 hover:text-[#111111]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 relative py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(194,163,107,0.05),transparent_50%)] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md mt-10"
        >
          <div className="bg-white rounded-3xl border border-gray-100 p-8 sm:p-10 shadow-xl shadow-black/5 relative overflow-hidden text-center">
            <div className="absolute top-0 left-0 w-full h-1 bg-gold/20" />
            
            {submitted ? (
              <div className="space-y-6">
                <div className="w-16 h-16 rounded-full bg-[#fdfbf7] flex items-center justify-center mx-auto text-gold border border-[#f5eedf] shadow-sm">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <div>
                  <h2 className="font-playfair text-3xl font-normal text-[#111111] mb-4">Check your inbox</h2>
                  <p className="text-gray-500 font-light leading-relaxed mb-6">
                    If a wedding gallery exists for <span className="text-[#111111] font-medium">{email}</span>, we just sent you an email with one-tap links to your gallery. For your privacy we never confirm whether an email is on file.
                  </p>
                  <p className="text-xs text-gray-400 font-light leading-relaxed">
                    Didn't get it? Check spam. You can also try again in a few minutes - we rate-limit recovery requests to protect everyone's inbox.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSubmitted(false);
                    setEmail("");
                  }}
                  className="w-full h-12 rounded-full font-medium border-gray-200 mt-4"
                  data-testid="find-gallery-reset"
                >
                  Try another address
                </Button>
              </div>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] mx-auto">
                  <Images className="h-7 w-7" />
                </div>
                <h1 className="font-playfair text-3xl font-normal tracking-tight text-[#111111] mb-4">Find my gallery</h1>
                
                <p className="text-gray-500 font-light leading-relaxed mb-4 text-sm">
                  Enter the email you used at the venue kiosk. We'll email you one-tap links to any wedding galleries we have on file.
                </p>
                <p className="text-xs text-gray-400 font-light leading-relaxed mb-8">
                  We never display a list of sessions in the browser; your galleries only appear in the email we send.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="relative text-left">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-14 pl-12 rounded-2xl bg-gray-50/50 border-gray-200 text-base focus-visible:ring-gold"
                      data-testid="find-gallery-email"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || !email.trim()}
                    className="w-full h-14 bg-black hover:bg-gray-800 text-white rounded-full font-medium shadow-md"
                    data-testid="find-gallery-submit"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Send Me My Links"
                    )}
                  </Button>
                </form>

                {error && (
                  <p className="text-rose-500 text-sm mt-4 font-medium" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
}

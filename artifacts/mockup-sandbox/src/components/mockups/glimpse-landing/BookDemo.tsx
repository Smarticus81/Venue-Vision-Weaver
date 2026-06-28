import React from "react";
import { Check, Clock, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav, SiteFooter, Pill } from "./_shared";
import "./_group.css";

export function BookDemo() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">
      <SiteNav active="BookDemo" />

      <main>
        <section className="pt-16 pb-24 md:pt-24 md:pb-32">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">

              {/* Left: copy + reassurance */}
              <div className="max-w-xl animate-fade-in-up">
                <div className="mb-7">
                  <Pill>
                    <Sparkles className="w-3.5 h-3.5 text-gold" />
                    Free branded sample included
                  </Pill>
                </div>
                <h1 className="text-[2.75rem] md:text-[3.75rem] leading-[1.05] tracking-tighter font-extrabold mb-6">
                  Book your <span className="text-gold">demo.</span>
                </h1>
                <p className="text-lg md:text-xl text-gray-500 font-light leading-relaxed mb-10">
                  Twenty minutes is all it takes. We&rsquo;ll walk you through the ROI and create a
                  free branded preview from your own venue photos.
                </p>

                <div className="rounded-3xl overflow-hidden border border-gray-100 shadow-sm mb-10 aspect-[16/10]">
                  <img src="/__mockup/images/couple-entrance.png" alt="A couple arriving at a venue" className="w-full h-full object-cover" />
                </div>

                <ul className="space-y-4">
                  {[
                    { icon: Check, text: "A free branded sample of your venue" },
                    { icon: Clock, text: "First previews back in 24 to 72 hours" },
                    { icon: ShieldCheck, text: "No long contracts, cancel any time" },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-3 text-gray-600">
                      <span className="w-9 h-9 rounded-xl bg-[#fdfbf7] flex items-center justify-center text-gold border border-[#f5eedf] flex-shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right: form */}
              <div className="lg:sticky lg:top-28 animate-fade-in-up delay-100">
                <div className="rounded-[2rem] border border-gray-100 shadow-2xl shadow-black/5 p-8 md:p-10 bg-white">
                  <h2 className="text-2xl font-bold tracking-tight mb-1">Tell us about your venue</h2>
                  <p className="text-gray-500 font-light mb-8">We&rsquo;ll reply within one business day.</p>

                  <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <Field label="Your name" placeholder="Jordan Avery" />
                      <Field label="Venue name" placeholder="The Grand Estate" />
                    </div>
                    <Field label="Work email" placeholder="you@venue.com" type="email" />
                    <Field label="Website" placeholder="venue.com" />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">What would you like to show couples?</label>
                      <textarea
                        rows={4}
                        placeholder="Ballroom, garden ceremony, seasonal looks..."
                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[#111111] placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C2A36B]/40 focus:border-[#C2A36B] transition-all resize-none"
                      />
                    </div>
                    <Button className="w-full bg-gold hover:bg-[#b09159] text-white rounded-full py-6 text-base font-medium transition-all shadow-lg shadow-[#C2A36B]/20">
                      Book my demo
                    </Button>
                    <p className="text-center text-xs text-gray-400">
                      By booking, you agree to our Privacy Policy. No spam, ever.
                    </p>
                  </form>
                </div>
              </div>

            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Field({
  label,
  placeholder,
  type = "text",
}: {
  label: string;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[#111111] placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#C2A36B]/40 focus:border-[#C2A36B] transition-all"
      />
    </div>
  );
}

import React from "react";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav, SiteFooter, Pill, SectionHeading } from "./_shared";
import "./_group.css";

const TIERS = [
  {
    name: "Single Venue",
    price: "$99",
    cadence: "per month",
    blurb: "Everything one venue needs to turn tours into bookings.",
    features: [
      "1 venue workspace",
      "Unlimited couple galleries",
      "4 stills + 1 motion reel per couple",
      "Capture at the tour or self-serve link",
      "Private galleries delivered by email",
    ],
    featured: false,
    cta: "Create workspace",
  },
  {
    name: "Multi-Space",
    price: "$299",
    cadence: "per month",
    blurb: "For venues marketing several spaces and seasons.",
    features: [
      "Up to 5 venue workspaces",
      "Unlimited couple galleries",
      "Priority generation",
      "Branded galleries and custom domain",
      "Built-in Book a tour CTAs",
      "Booking and gallery analytics",
    ],
    featured: true,
    cta: "Create workspace",
  },
  {
    name: "Venue Group",
    price: "Custom",
    cadence: "let's talk",
    blurb: "Multi-property brands and management groups with volume needs.",
    features: [
      "Unlimited venue workspaces",
      "Multi-property branding",
      "Dedicated account partner",
      "Team roles and permissions",
      "Onboarding and training",
      "Priority support",
    ],
    featured: false,
    cta: "Contact sales",
  },
];

export function Pricing() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">
      <SiteNav active="Pricing" />

      <main>
        {/* Hero */}
        <section className="pt-20 pb-12 md:pt-28 md:pb-16">
          <div className="container mx-auto px-6 text-center max-w-3xl animate-fade-in-up">
            <div className="flex justify-center mb-7">
              <Pill>
                <Sparkles className="w-3.5 h-3.5 text-gold" />
                One booking pays for itself
              </Pill>
            </div>
            <h1 className="text-[2.75rem] md:text-[4rem] leading-[1.05] tracking-tighter font-extrabold mb-6">
              Pricing that pays for <span className="text-gold">itself.</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-500 font-light leading-relaxed">
              Flat monthly plans with unlimited couple galleries. Most venues earn it back
              with a single additional booking. No long contracts, cancel any time.
            </p>
          </div>
        </section>

        {/* Tiers */}
        <section className="pb-20 md:pb-28">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 max-w-6xl mx-auto items-stretch">
              {TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className={`relative flex flex-col rounded-[2rem] p-8 md:p-10 transition-all ${
                    tier.featured
                      ? "bg-[#111111] text-white shadow-2xl shadow-black/20 lg:-mt-4 lg:mb-4"
                      : "bg-white border border-gray-100 hover:shadow-lg hover:shadow-black/5"
                  }`}
                >
                  {tier.featured && (
                    <span className="absolute top-6 right-6 bg-gold text-white text-xs font-semibold tracking-wide px-3 py-1 rounded-full">
                      Most popular
                    </span>
                  )}
                  <h3 className={`text-lg font-bold mb-2 ${tier.featured ? "text-white" : "text-[#111111]"}`}>{tier.name}</h3>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl md:text-5xl font-extrabold tracking-tight">{tier.price}</span>
                  </div>
                  <p className={`text-sm mb-5 ${tier.featured ? "text-gray-400" : "text-gray-400"}`}>{tier.cadence}</p>
                  <p className={`font-light leading-relaxed mb-8 ${tier.featured ? "text-gray-300" : "text-gray-500"}`}>{tier.blurb}</p>

                  <ul className="space-y-3 mb-10 flex-1">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${tier.featured ? "bg-gold/20 text-gold" : "bg-[#fdfbf7] text-gold border border-[#f5eedf]"}`}>
                          <Check className="w-3 h-3" />
                        </span>
                        <span className={`text-sm ${tier.featured ? "text-gray-200" : "text-gray-600"}`}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    asChild
                    className={`mt-auto w-full rounded-full py-6 text-base font-medium transition-all ${
                      tier.featured
                        ? "bg-gold hover:bg-[#b09159] text-white shadow-lg shadow-[#C2A36B]/30"
                        : "bg-[#111111] hover:bg-black text-white"
                    }`}
                  >
                    <a href="BookDemo">{tier.cta}</a>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <SectionHeading eyebrow="Good to know" title="Questions, answered" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-4xl mx-auto">
              {[
                { q: "Do we need a professional photoshoot?", a: "No. Upload the venue photos you already have once \u2014 that becomes the canvas for every couple's gallery." },
                { q: "How fast will couples see results?", a: "Instantly. Galleries generate in minutes, so a couple can see themselves in your venue before they leave the tour." },
                { q: "How do couples get added?", a: "Snap a couple of photos and their email at the tour from your dashboard, or share your venue link and let couples add themselves." },
                { q: "Is each gallery private?", a: "Yes. Every couple gets their own secure link, delivered by email \u2014 galleries are never posted publicly." },
              ].map(({ q, a }) => (
                <div key={q} className="rounded-3xl bg-white border border-[#f0e6d2]/60 p-7">
                  <h3 className="text-lg font-bold mb-2">{q}</h3>
                  <p className="text-gray-500 font-light leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 bg-[#111111] text-white">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Not sure which plan fits?</h2>
            <p className="text-xl text-gray-300 font-light mb-10 max-w-xl mx-auto">
              Start with any plan, set up your venue, and send your first couple a gallery today.
            </p>
            <Button asChild className="bg-gold hover:bg-[#b09159] text-white rounded-full px-10 py-7 text-lg font-medium transition-all shadow-xl shadow-[#C2A36B]/20">
              <a href="BookDemo">Create venue workspace <ArrowRight className="ml-2 h-5 w-5" /></a>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

import React from "react";
import {
  ImageUp,
  Wand2,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav, SiteFooter, Pill, SectionHeading } from "./_shared";
import "./_group.css";

export function HowItWorks() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">
      <SiteNav active="HowItWorks" />

      <main>
        {/* Hero */}
        <section className="pt-20 pb-12 md:pt-28 md:pb-16">
          <div className="container mx-auto px-6 text-center max-w-3xl animate-fade-in-up">
            <div className="flex justify-center mb-7">
              <Pill>
                <Sparkles className="w-3.5 h-3.5 text-gold" />
                From your photos to booked weddings
              </Pill>
            </div>
            <h1 className="text-[2.75rem] md:text-[4rem] leading-[1.05] tracking-tighter font-extrabold mb-6">
              How Glimpse <span className="text-gold">works</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-500 font-light leading-relaxed">
              No new shoot. No software to learn. Send us the venue photos you already have,
              and we turn them into branded preview galleries your prospects fall in love with.
            </p>
          </div>
        </section>

        {/* Steps with imagery */}
        <section className="py-12 md:py-20">
          <div className="container mx-auto px-6 flex flex-col gap-20 md:gap-28">
            {[
              {
                step: "01",
                icon: ImageUp,
                title: "Send us your space",
                body: "Share your existing venue photos. We map your rooms, lighting and signature angles, so every render stays true to the real place couples will tour.",
                points: ["No photoshoot or equipment needed", "Works from the photos you already have", "We handle the heavy lifting"],
                img: "venue-empty.png",
              },
              {
                step: "02",
                icon: Wand2,
                title: "We craft the preview",
                body: "Our team builds photoreal, true-to-space galleries with accurate scale, natural lighting and believable shadows, tastefully branded to your venue and ready for every channel.",
                points: ["Branded to your venue", "Compact variants for ads, email and embeds", "Delivered in 24 to 72 hours"],
                img: "venue-styled.png",
              },
              {
                step: "03",
                icon: CheckCircle2,
                title: "Approve and convert",
                body: "Review every render, request changes, and approve what goes live. Publish to your site, ads and emails with a clear inquiry CTA, then watch tours turn into bookings.",
                points: ["Full owner approval controls", "Optional demo watermarking for privacy", "Clear inquiry CTAs built in"],
                img: "owner-review.png",
              },
            ].map(({ step, icon: Icon, title, body, points, img }, i) => (
              <div key={step} className={`grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                <div className="max-w-xl">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center text-gold shadow-sm border border-[#f5eedf]">
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-sm font-semibold tracking-widest uppercase text-gold">Step {step}</span>
                  </div>
                  <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">{title}</h2>
                  <p className="text-gray-500 text-lg font-light leading-relaxed mb-6">{body}</p>
                  <ul className="space-y-3">
                    {points.map((p) => (
                      <li key={p} className="flex items-center gap-3 text-gray-600">
                        <CheckCircle2 className="w-5 h-5 text-gold flex-shrink-0" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="relative">
                  <div className="rounded-[2rem] overflow-hidden shadow-2xl shadow-black/5 border border-gray-50/50 aspect-[4/3]">
                    <img src={`/__mockup/images/${img}`} alt={title} className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-br from-[#fdfbf7] to-white rounded-full blur-3xl opacity-50" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Before / After */}
        <section className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <SectionHeading
              eyebrow="The same space, transformed"
              title="From empty room to their wedding day"
              subtitle="We keep your venue exactly as it is, then let couples picture the celebration inside it."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-5xl mx-auto">
              {[
                { img: "venue-empty.png", tag: "Before", note: "Your real space, as you photographed it" },
                { img: "venue-styled.png", tag: "After", note: "Reimagined for their wedding day" },
              ].map(({ img, tag, note }) => (
                <div key={tag} className="relative rounded-[2rem] overflow-hidden border border-[#f0e6d2]/60 shadow-sm aspect-[4/3]">
                  <img src={`/__mockup/images/${img}`} alt={tag} className="w-full h-full object-cover" />
                  <span className="absolute top-4 left-4 bg-white/90 backdrop-blur px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide text-[#111111]">{tag}</span>
                  <span className="absolute bottom-4 left-4 right-4 text-white text-sm font-medium drop-shadow">{note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Reassurance band */}
        <section className="py-20 md:py-28 bg-white">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[
                { icon: Clock, title: "Fast by design", body: "First samples land in 24 to 72 hours, so you can start converting this week." },
                { icon: CheckCircle2, title: "You stay in control", body: "Nothing publishes without your approval. Request changes any time." },
                { icon: ShieldCheck, title: "Private until launch", body: "Optional demo watermarking protects work in progress and sensitive spaces." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-3xl border border-gray-100 p-8 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-5 mx-auto text-gold border border-[#f5eedf]">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{title}</h3>
                  <p className="text-gray-500 font-light leading-relaxed text-sm">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 bg-[#111111] text-white">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">See it on your own venue</h2>
            <p className="text-xl text-gray-300 font-light mb-10 max-w-xl mx-auto">
              Book a 20 minute demo and we&rsquo;ll create a free branded sample from your photos.
            </p>
            <Button asChild className="bg-gold hover:bg-[#b09159] text-white rounded-full px-10 py-7 text-lg font-medium transition-all shadow-xl shadow-[#C2A36B]/20">
              <a href="BookDemo">Book a demo <ArrowRight className="ml-2 h-5 w-5" /></a>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

import React from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav, SiteFooter, Pill, SectionHeading } from "./_shared";
import "./_group.css";

const SHOTS = [
  { src: "venue-styled.png", title: "Grand ballroom reception", tag: "Reception", span: "md:col-span-2 aspect-[16/9]" },
  { src: "garden-ceremony.png", title: "Garden ceremony", tag: "Ceremony", span: "aspect-[4/5]" },
  { src: "couple-entrance.png", title: "The grand entrance", tag: "Moments", span: "aspect-[4/5]" },
  { src: "reception-table.png", title: "Table styling detail", tag: "Details", span: "aspect-[4/5]" },
  { src: "ballroom-evening.png", title: "Evening ambiance", tag: "Reception", span: "md:col-span-2 aspect-[16/9]" },
  { src: "couple-venue-tour.png", title: "Touring the space", tag: "Moments", span: "aspect-[4/5]" },
];

export function Gallery() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">
      <SiteNav active="Gallery" />

      <main>
        {/* Hero */}
        <section className="pt-20 pb-12 md:pt-28 md:pb-16">
          <div className="container mx-auto px-6 text-center max-w-3xl animate-fade-in-up">
            <div className="flex justify-center mb-7">
              <Pill>
                <Sparkles className="w-3.5 h-3.5 text-gold" />
                What lands in a couple&rsquo;s inbox
              </Pill>
            </div>
            <h1 className="text-[2.75rem] md:text-[4rem] leading-[1.05] tracking-tighter font-extrabold mb-6">
              See the <span className="text-gold">difference.</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-500 font-light leading-relaxed">
              Every gallery is personal &mdash; a real couple, placed inside your real venue.
              This is the kind of preview couples fall in love with after a tour.
            </p>
          </div>
        </section>

        {/* Before / After feature */}
        <section className="pb-16 md:pb-20">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-5xl mx-auto">
              {[
                { img: "venue-empty.png", tag: "Your venue", note: "The real space" },
                { img: "venue-styled.png", tag: "Their gallery", note: "The couple, placed in your space" },
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

        {/* Masonry-ish grid */}
        <section className="pb-20 md:pb-28">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {SHOTS.map(({ src, title, tag, span }) => (
                <div key={src + title} className={`group relative overflow-hidden rounded-3xl border border-gray-100 ${span}`}>
                  <img src={`/__mockup/images/${src}`} alt={title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-80" />
                  <span className="absolute top-4 left-4 bg-white/85 backdrop-blur px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide text-[#111111]">{tag}</span>
                  <span className="absolute bottom-4 left-4 text-white font-medium">{title}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What every couple receives */}
        <section className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <SectionHeading
              eyebrow="Every gallery, the same promise"
              title="What every couple receives"
              subtitle="One private gallery per couple, generated in minutes and delivered by email with a Book a tour button."
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                { label: "4 editorial stills", ratio: "aspect-[4/5]", src: "garden-ceremony.png" },
                { label: "1 cinematic motion reel", ratio: "aspect-[4/5]", src: "ballroom-evening.png" },
                { label: "A private gallery link", ratio: "aspect-[4/5]", src: "couple-entrance.png" },
              ].map(({ label, ratio, src }) => (
                <div key={label} className="text-center">
                  <div className={`rounded-2xl overflow-hidden border border-[#f0e6d2]/60 shadow-sm mb-4 ${ratio}`}>
                    <img src={`/__mockup/images/${src}`} alt={label} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 bg-[#111111] text-white">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">Want this for your venue?</h2>
            <p className="text-xl text-gray-300 font-light mb-10 max-w-xl mx-auto">
              Create your workspace and send your first couple a personalized gallery in minutes.
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

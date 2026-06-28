import React from "react";
import {
  ArrowRight,
  Sun,
  Palette,
  CheckCircle2,
  ShieldCheck,
  Clock,
  TrendingUp,
  CalendarCheck,
  Sparkles,
  ImageUp,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav, SiteFooter, Pill, SectionHeading, GoldLink } from "./_shared";
import "./_group.css";

export function Landing() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">
      <SiteNav />

      <main>
        {/* Hero Section */}
        <section className="pt-20 pb-16 md:pt-28 md:pb-20 overflow-hidden">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">

              <div className="max-w-xl animate-fade-in-up">
                <div className="mb-7">
                  <Pill>
                    <Sparkles className="w-3.5 h-3.5 text-gold" />
                    Branded preview galleries for venues
                  </Pill>
                </div>

                <h1 className="text-[3rem] md:text-[4rem] leading-[1.05] tracking-tighter font-extrabold text-[#111111] mb-6">
                  Turn your booked tours<br/>
                  into <span className="text-gold">booked weddings.</span>
                </h1>

                <p className="text-lg md:text-xl text-gray-500 mb-9 max-w-lg leading-relaxed font-light">
                  Glimpse places prospective couples inside your venue&rsquo;s real photos.
                  Photoreal, true-to-space preview galleries, tastefully branded to you.
                  They picture their day, and you book more weddings.
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <Button asChild className="w-full sm:w-auto bg-gold hover:bg-[#b09159] text-white rounded-full px-8 py-6 text-base font-medium transition-all shadow-lg shadow-[#C2A36B]/20">
                    <a href="BookDemo">Create venue workspace</a>
                  </Button>
                  <Button asChild variant="ghost" className="w-full sm:w-auto rounded-full px-8 py-6 text-base font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50 group">
                    <a href="Gallery">See a sample gallery <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" /></a>
                  </Button>
                </div>

                <p className="mt-6 text-sm text-gray-400 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gold" />
                  Galleries generate in minutes. Couples get a private link by email.
                </p>
              </div>

              <div className="relative animate-fade-in-up delay-100 flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[500px] aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/5 border border-gray-50/50">
                  <img
                    src="/__mockup/images/couple-venue-tour.png"
                    alt="A couple visualizing their wedding inside a venue"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none"></div>
                </div>

                <div className="absolute bottom-6 -left-2 sm:left-2 bg-white/95 backdrop-blur rounded-2xl shadow-xl shadow-black/10 border border-gray-100 px-5 py-4 flex items-center gap-3 animate-fade-in-up delay-200">
                  <div className="w-10 h-10 rounded-xl bg-[#fdfbf7] flex items-center justify-center text-gold border border-[#f5eedf]">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-lg font-bold leading-none text-[#111111]">+31%</div>
                    <div className="text-xs text-gray-500 mt-1">tour requests</div>
                  </div>
                </div>

                <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-br from-[#fdfbf7] to-white rounded-full blur-3xl opacity-50"></div>
              </div>

            </div>
          </div>
        </section>

        {/* Partner Strip */}
        <section className="py-10 border-y border-gray-50 bg-gray-50/30">
          <div className="container mx-auto px-6">
            <p className="text-center text-xs font-semibold tracking-widest uppercase text-gray-400 mb-8">Trusted by premier venues</p>
            <div className="flex flex-wrap justify-center gap-x-12 md:gap-x-20 gap-y-8 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
              {["The Grand Estate", "Rosewood Manor", "Lakeside Pavilion", "Ivy & Oak", "Belvedere Hall"].map((venue) => (
                <div key={venue} className="text-lg md:text-xl font-playfair font-medium text-gray-600">
                  {venue}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Results / Metrics Band */}
        <section id="results" className="py-20 md:py-28 bg-white">
          <div className="container mx-auto px-6">
            <SectionHeading
              eyebrow="Measurable ROI"
              title="Fewer empty dates. Shorter sales cycles."
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 md:gap-8 max-w-4xl mx-auto">
              {[
                { stat: "3.2x", label: "more qualified tour requests", icon: TrendingUp },
                { stat: "38%", label: "shorter average sales cycle", icon: CalendarCheck },
                { stat: "+27%", label: "lift in booking conversion", icon: CheckCircle2 },
              ].map(({ stat, label, icon: Icon }) => (
                <div key={label} className="rounded-3xl border border-gray-100 bg-white p-8 text-center hover:shadow-lg hover:shadow-black/5 transition-all">
                  <div className="w-11 h-11 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-5 mx-auto text-gold border border-[#f5eedf]">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#111111] mb-2">{stat}</div>
                  <p className="text-gray-500 font-light text-sm leading-relaxed">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-gray-400 mt-8">Illustrative results from early venue partners. Your mileage varies by market and offer.</p>
          </div>
        </section>

        {/* Gallery Preview */}
        <section className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
              <div className="max-w-xl">
                <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">The same space, reimagined</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111]">
                  Show couples what their day could look like
                </h2>
              </div>
              <GoldLink href="Gallery">Explore the full gallery</GoldLink>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
              {[
                { src: "venue-styled.png", label: "Ballroom reception", span: "md:col-span-2 md:row-span-2 aspect-[4/3] md:aspect-auto" },
                { src: "garden-ceremony.png", label: "Garden ceremony", span: "aspect-square" },
                { src: "reception-table.png", label: "Table styling", span: "aspect-square" },
                { src: "couple-entrance.png", label: "Grand entrance", span: "aspect-square" },
                { src: "ballroom-evening.png", label: "Evening ambiance", span: "aspect-square" },
              ].map(({ src, label, span }) => (
                <div key={src} className={`group relative overflow-hidden rounded-3xl border border-[#f0e6d2]/60 ${span}`}>
                  <img src={`/__mockup/images/${src}`} alt={label} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="absolute bottom-4 left-4 text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 md:py-32 bg-white">
          <div className="container mx-auto px-6">
            <SectionHeading
              eyebrow="Built for booking"
              title="Personal, photoreal, true to your space"
              subtitle="Every gallery places a real couple inside your real venue, and points them straight at booking a tour."
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {[
                { icon: Sun, title: "True-to-space realism", body: "Accurate scale, natural lighting and believable shadows. Couples see your venue, not a generic render." },
                { icon: Palette, title: "Tasteful venue branding", body: "Your name, colors and details, woven in elegantly. Premium and warm, never busy or templated." },
                { icon: Wand2, title: "Personalized to each couple", body: "The couple's own likeness, placed inside your real spaces, so the preview feels unmistakably theirs." },
                { icon: CalendarCheck, title: "Two ways to add couples", body: "Capture them during the tour from your dashboard, or share your link and let couples add themselves." },
                { icon: ShieldCheck, title: "Private galleries by email", body: "Each couple gets their own secure share link with a Book a tour CTA. Nothing is posted publicly." },
                { icon: Clock, title: "Generated in minutes", body: "AI builds four editorial stills and a cinematic motion reel automatically, no shoot and no waiting." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="group rounded-3xl p-8 transition-all hover:bg-gray-50/60 border border-transparent hover:border-gray-100">
                  <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] group-hover:scale-110 transition-transform">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-[#111111]">{title}</h3>
                  <p className="text-gray-500 font-light leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works (condensed) */}
        <section className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
              <div className="max-w-xl">
                <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">How it works</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111]">From tour to gallery in minutes</h2>
              </div>
              <GoldLink href="HowItWorks">See the full process</GoldLink>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { step: "01", icon: ImageUp, title: "Create your venue", body: "Sign up and upload a few real photos of your spaces. They become the canvas for every couple's gallery." },
                { step: "02", icon: Wand2, title: "Add a couple", body: "Snap a couple of photos and their email at the tour, or share your venue link and let them add themselves." },
                { step: "03", icon: CheckCircle2, title: "They picture their day", body: "Glimpse places them in your real venue in minutes and emails a private gallery with a Book a tour button." },
              ].map(({ step, icon: Icon, title, body }) => (
                <div key={step} className="relative rounded-3xl bg-white border border-[#f0e6d2]/60 p-8 shadow-sm">
                  <span className="absolute top-6 right-7 text-5xl font-extrabold text-[#f0e6d2]">{step}</span>
                  <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf]">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-[#111111]">{title}</h3>
                  <p className="text-gray-500 font-light leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-24 bg-[#111111] text-white">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <Sparkles className="w-8 h-8 text-gold mx-auto mb-6" />
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
              Turn lookers into booked weddings
            </h2>
            <p className="text-xl text-gray-300 font-light mb-10 max-w-xl mx-auto">
              Create your venue workspace and send your first couple a personalized gallery today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button asChild className="w-full sm:w-auto bg-gold hover:bg-[#b09159] text-white rounded-full px-10 py-7 text-lg font-medium transition-all shadow-xl shadow-[#C2A36B]/20">
                <a href="BookDemo">Create venue workspace</a>
              </Button>
              <Button asChild variant="ghost" className="w-full sm:w-auto rounded-full px-10 py-7 text-lg font-medium text-gray-200 hover:text-white hover:bg-white/10 group">
                <a href="Gallery">See a sample gallery <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" /></a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

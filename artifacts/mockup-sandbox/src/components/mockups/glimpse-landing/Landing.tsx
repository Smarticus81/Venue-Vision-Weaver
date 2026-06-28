import React from "react";
import {
  ArrowRight,
  Menu,
  Sun,
  Palette,
  Megaphone,
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
import "./_group.css";

export function Landing() {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-jakarta selection:bg-[#C2A36B] selection:text-white overflow-x-hidden">

      {/* Top Nav */}
      <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight">Glimpse</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#how" className="hover:text-[#111111] transition-colors">How it works</a>
            <a href="#results" className="hover:text-[#111111] transition-colors">Results</a>
            <a href="#features" className="hover:text-[#111111] transition-colors">Features</a>
            <a href="#pricing" className="hover:text-[#111111] transition-colors">Pricing</a>
          </nav>

          <div className="flex items-center gap-3">
            <Button variant="ghost" className="hidden md:inline-flex rounded-full px-5 text-sm font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50">
              Sign in
            </Button>
            <Button className="hidden md:inline-flex bg-gold hover:bg-[#b09159] text-white rounded-full px-6 text-sm font-medium shadow-lg shadow-[#C2A36B]/20">
              Book a demo
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="pt-20 pb-16 md:pt-28 md:pb-20 overflow-hidden">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">

              {/* Left Column: Copy */}
              <div className="max-w-xl animate-fade-in-up">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 mb-7 text-xs font-semibold tracking-wide text-[#8a7340]">
                  <Sparkles className="w-3.5 h-3.5 text-gold" />
                  Branded preview galleries for venues
                </div>

                <h1 className="text-[3.25rem] md:text-[4.25rem] leading-[1.04] tracking-tighter font-extrabold text-[#111111] mb-6">
                  Let couples picture<br/>
                  their wedding.<br/>
                  <span className="text-gold">Before they book.</span>
                </h1>

                <p className="text-lg md:text-xl text-gray-500 mb-9 max-w-lg leading-relaxed font-light">
                  Glimpse places prospective couples inside your venue&rsquo;s real photos &mdash;
                  photoreal, true-to-space preview galleries, tastefully branded to you.
                  They visualize their day, and you book more weddings.
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <Button className="w-full sm:w-auto bg-gold hover:bg-[#b09159] text-white rounded-full px-8 py-6 text-base font-medium transition-all shadow-lg shadow-[#C2A36B]/20">
                    Book a demo
                  </Button>
                  <Button variant="ghost" className="w-full sm:w-auto rounded-full px-8 py-6 text-base font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50 group">
                    See a sample gallery <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>

                <p className="mt-6 text-sm text-gray-400 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gold" />
                  First samples delivered in 24&ndash;72 hours. No new photoshoot required.
                </p>
              </div>

              {/* Right Column: Image */}
              <div className="relative animate-fade-in-up delay-100 flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[500px] aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/5 border border-gray-50/50">
                  <img
                    src="/__mockup/images/couple-venue-tour.png"
                    alt="A couple visualizing their wedding inside a venue"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none"></div>
                </div>

                {/* Floating proof card */}
                <div className="absolute bottom-6 -left-2 sm:left-2 bg-white/95 backdrop-blur rounded-2xl shadow-xl shadow-black/10 border border-gray-100 px-5 py-4 flex items-center gap-3 animate-fade-in-up delay-200">
                  <div className="w-10 h-10 rounded-xl bg-[#fdfbf7] flex items-center justify-center text-gold border border-[#f5eedf]">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-lg font-bold leading-none text-[#111111]">+31%</div>
                    <div className="text-xs text-gray-500 mt-1">tour requests</div>
                  </div>
                </div>

                {/* Decorative element */}
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
            <div className="text-center max-w-2xl mx-auto mb-14">
              <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">Measurable ROI</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111]">
                Fewer empty dates. Shorter sales cycles.
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 md:gap-8 max-w-4xl mx-auto">
              {[
                { stat: "3.2x", label: "more qualified tour requests", icon: TrendingUp },
                { stat: "−38%", label: "shorter average sales cycle", icon: CalendarCheck },
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

        {/* How It Works */}
        <section id="how" className="py-20 md:py-28 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">How it works</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-4">
                Live in days, not weeks
              </h2>
              <p className="text-gray-500 text-lg font-light">
                No new shoot, no software to learn. Send us your space and we handle the rest.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  step: "01",
                  icon: ImageUp,
                  title: "Send us your space",
                  body: "Share the venue photos you already have. We map your rooms, lighting, and signature angles.",
                },
                {
                  step: "02",
                  icon: Wand2,
                  title: "We craft the preview",
                  body: "Photoreal, true-to-space galleries with accurate scale, lighting and shadows — branded to you. Delivered in 24–72h.",
                },
                {
                  step: "03",
                  icon: CheckCircle2,
                  title: "Approve & convert",
                  body: "Review and approve every render, then publish to your site, ads and emails with a clear inquiry CTA.",
                },
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

        {/* Features Section */}
        <section id="features" className="py-24 md:py-32 bg-white">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-16 md:mb-20">
              <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">Built for booking</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-4">
                Marketing-first, true to your space
              </h2>
              <p className="text-gray-500 text-lg font-light">
                Every output is designed to win the inquiry — and to protect your brand while it does.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {[
                {
                  icon: Sun,
                  title: "True-to-space realism",
                  body: "Accurate scale, natural lighting and believable shadows — couples see your venue, not a generic render.",
                },
                {
                  icon: Palette,
                  title: "Tasteful venue branding",
                  body: "Your name, colors and details, woven in elegantly. Premium and warm, never busy or templated.",
                },
                {
                  icon: Megaphone,
                  title: "Ready for every channel",
                  body: "Compact variants sized for ads, email and on-site embeds — drop them straight into your funnel.",
                },
                {
                  icon: CheckCircle2,
                  title: "Owner approval controls",
                  body: "Nothing goes live without your sign-off. Review, request changes, and approve every gallery.",
                },
                {
                  icon: ShieldCheck,
                  title: "Privacy by default",
                  body: "Optional demo watermarking keeps work-in-progress and sensitive spaces protected before launch.",
                },
                {
                  icon: Clock,
                  title: "Fast sample delivery",
                  body: "First previews back in 24–72 hours, so you can test, iterate and start converting this week.",
                },
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

        {/* Closing CTA */}
        <section id="pricing" className="py-24 bg-[#111111] text-white">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <Sparkles className="w-8 h-8 text-gold mx-auto mb-6" />
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
              Turn lookers into booked weddings
            </h2>
            <p className="text-xl text-gray-300 font-light mb-10 max-w-xl mx-auto">
              See a branded sample of your own venue, free. We&rsquo;ll walk you through the ROI on a 20-minute demo.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button className="w-full sm:w-auto bg-gold hover:bg-[#b09159] text-white rounded-full px-10 py-7 text-lg font-medium transition-all shadow-xl shadow-[#C2A36B]/20">
                Book a demo
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto rounded-full px-10 py-7 text-lg font-medium text-gray-200 hover:text-white hover:bg-white/10 group">
                Get a free sample <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white py-12 border-t border-gray-100">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-gray-300">Glimpse</span>
          </div>

          <div className="flex flex-wrap justify-center gap-8 text-sm text-gray-400">
            <a href="#how" className="hover:text-gold transition-colors">How it works</a>
            <a href="#results" className="hover:text-gold transition-colors">Results</a>
            <a href="#pricing" className="hover:text-gold transition-colors">Pricing</a>
            <a href="#" className="hover:text-gold transition-colors">Privacy</a>
            <a href="#" className="hover:text-gold transition-colors">Book a demo</a>
          </div>

          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} Glimpse. For venues, by design.
          </p>
        </div>
      </footer>
    </div>
  );
}

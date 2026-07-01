import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  Clock3,
  ImageUp,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const HERO_IMAGE = "/brand/venue-landing-hero.png";

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-[#111111] font-sans selection:bg-gold selection:text-white">
      <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="flex items-center gap-2"
            aria-label="Glimpse home"
          >
            <span className="text-2xl font-bold tracking-tight text-[#111111]">
              Glimpse<span className="text-gold">.</span>
            </span>
          </button>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => setLocation("/login")}
              className="hidden md:inline-flex rounded-full px-5 text-sm font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50"
              data-testid="venue-header-sign-in"
            >
              Sign in
            </Button>
            <Button
              variant="gold"
              onClick={() => setLocation("/create-venue")}
              className="hidden md:inline-flex shadow-lg shadow-[#C2A36B]/20"
              data-testid="venue-header-register"
            >
              Register <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="pt-20 pb-16 md:pt-28 md:pb-20 overflow-hidden">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-xl"
              >
                <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#8a7340]">
                  <Sparkles className="h-3.5 w-3.5 text-gold" />
                  Post-tour booking galleries
                </div>
                <h1 className="text-[3rem] md:text-[4rem] leading-[1.05] tracking-tighter font-extrabold text-[#111111] mb-6">
                  Turn venue tours into <span className="text-gold font-playfair italic font-normal">bookings.</span>
                </h1>
                <p className="text-lg md:text-xl text-gray-500 mb-9 max-w-lg leading-relaxed font-light">
                  Glimpse helps couples picture their wedding in your actual venue after
                  the tour, with photoreal galleries that place them inside your real
                  spaces and make the next step feel obvious.
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <Button
                    size="lg"
                    variant="gold"
                    onClick={() => setLocation("/create-venue")}
                    className="w-full sm:w-auto px-8 py-6 text-base shadow-lg shadow-[#C2A36B]/20"
                    data-testid="venue-hero-register"
                  >
                    Start venue workspace
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={() => setLocation("/login")}
                    className="w-full sm:w-auto rounded-full px-8 py-6 text-base font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50 group"
                    data-testid="owner-cta"
                  >
                    Owner Login <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="relative flex justify-center lg:justify-end"
              >
                <div className="relative w-full max-w-[500px] aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/5 border border-gray-50">
                  <img
                    src={HERO_IMAGE}
                    alt="Wedding venue ceremony space"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none" />
                  
                  <div className="absolute bottom-6 left-6 right-6">
                    <div className="rounded-2xl border border-white/30 bg-white/18 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-2xl">
                      <p className="text-xs font-semibold tracking-[0.18em] uppercase text-white/90">
                        Post-tour follow-up
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        {["See it", "Feel it", "Book it"].map((item) => (
                          <div key={item} className="rounded-xl bg-white/20 px-3 py-2.5 text-center text-sm font-medium">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-br from-[#fdfbf7] to-white rounded-full blur-3xl opacity-50"></div>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="py-24 md:py-32 bg-white">
          <div className="container mx-auto px-6">
            <div className="max-w-2xl text-center mx-auto mb-14">
              <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">After the tour</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-4">Built to increase bookings</h2>
              <p className="text-gray-500 text-lg font-light leading-relaxed">
                Send each couple a personalized vision of their wedding in your venue while the tour is still fresh.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              {[
                {
                  icon: <ImageUp className="w-6 h-6" />,
                  title: "Their day, your venue",
                  text: "Use real venue photos to show each couple inside the rooms, ceremony spaces, light, and details they just toured.",
                },
                {
                  icon: <ShieldCheck className="w-6 h-6" />,
                  title: "Sales team approval",
                  text: "Preview every gallery before sending so follow-up stays polished, accurate, and aligned with your brand.",
                },
                {
                  icon: <MonitorSmartphone className="w-6 h-6" />,
                  title: "Follow-up that moves",
                  text: "Give couples a reason to reopen the conversation, share the venue, and take the booking step.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="group rounded-3xl border border-gray-100 bg-white p-8 shadow-sm transition-all hover:shadow-lg hover:shadow-black/5"
                >
                  <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] group-hover:scale-110 transition-transform">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold tracking-tight text-[#111111] mb-3">{item.title}</h3>
                  <p className="text-gray-500 font-light leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-[1fr_1.5fr] gap-12 items-center max-w-5xl mx-auto">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-6">Make the decision feel real.</h2>
                <p className="text-gray-500 text-lg font-light leading-relaxed mb-8">
                  A tour shows the venue. Glimpse shows the couple what their wedding could look like there.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-1">
                {[
                  "Personalized gallery follow-up after each tour",
                  "Clear booking CTAs on every gallery",
                  "Built around tour-to-booking conversion",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-4 rounded-2xl bg-white border border-[#f0e6d2]/60 p-5 shadow-sm">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#fdfbf7] border border-[#f5eedf] text-gold">
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="text-base font-medium text-[#111111]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 bg-white">
          <div className="container mx-auto px-6">
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  icon: <BarChart3 className="h-6 w-6" />,
                  value: "Tour-to-booking",
                  label: "Follow up with a branded vision of their day before the venue decision cools off.",
                },
                {
                  icon: <Clock3 className="h-6 w-6" />,
                  value: "24-72h",
                  label: "Quick personalized delivery for couples who have already walked the space.",
                },
                {
                  icon: <CalendarCheck className="h-6 w-6" />,
                  value: "Book next",
                  label: "Every gallery keeps the next booking step visible, tasteful, and venue-owned.",
                },
              ].map((metric) => (
                <div key={metric.value} className="rounded-3xl border border-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#f5eedf] bg-[#fdfbf7] text-gold">
                    {metric.icon}
                  </div>
                  <p className="text-3xl font-extrabold tracking-tight text-[#111111]">{metric.value}</p>
                  <p className="mt-3 text-sm font-light leading-relaxed text-gray-500">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      
      <footer className="bg-white py-12 border-t border-gray-100">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <span className="text-xl font-bold tracking-tight text-gray-300">Glimpse</span>
          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} Glimpse. For venues, by design.
          </p>
        </div>
      </footer>
    </div>
  );
}

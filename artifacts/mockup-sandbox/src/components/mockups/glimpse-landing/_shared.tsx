import React from "react";
import { Menu, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./_group.css";

const NAV = [
  { label: "How it works", href: "HowItWorks" },
  { label: "Gallery", href: "Gallery" },
  { label: "Pricing", href: "Pricing" },
];

export function SiteNav({ active }: { active?: string }) {
  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <a href="Landing" className="flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight text-[#111111]">Glimpse</span>
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`transition-colors hover:text-[#111111] ${active === item.href ? "text-[#111111]" : ""}`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button variant="ghost" className="hidden md:inline-flex rounded-full px-5 text-sm font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50">
            Sign in
          </Button>
          <Button asChild className="hidden md:inline-flex bg-gold hover:bg-[#b09159] text-white rounded-full px-6 text-sm font-medium shadow-lg shadow-[#C2A36B]/20">
            <a href="BookDemo">Book a demo</a>
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-white py-12 border-t border-gray-100">
      <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <a href="Landing" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-gray-300">Glimpse</span>
        </a>

        <div className="flex flex-wrap justify-center gap-8 text-sm text-gray-400">
          <a href="HowItWorks" className="hover:text-gold transition-colors">How it works</a>
          <a href="Gallery" className="hover:text-gold transition-colors">Gallery</a>
          <a href="Pricing" className="hover:text-gold transition-colors">Pricing</a>
          <a href="BookDemo" className="hover:text-gold transition-colors">Book a demo</a>
          <a href="#" className="hover:text-gold transition-colors">Privacy</a>
        </div>

        <p className="text-sm text-gray-400">
          &copy; {new Date().getFullYear()} Glimpse. For venues, by design.
        </p>
      </div>
    </footer>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#8a7340]">
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  center = true,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <div className={`max-w-2xl mb-14 ${center ? "text-center mx-auto" : ""}`}>
      {eyebrow && (
        <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-4">{eyebrow}</p>
      )}
      <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-4">{title}</h2>
      {subtitle && <p className="text-gray-500 text-lg font-light leading-relaxed">{subtitle}</p>}
    </div>
  );
}

export function GoldLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="inline-flex items-center font-medium text-gold hover:text-[#b09159] transition-colors group">
      {children}
      <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
    </a>
  );
}

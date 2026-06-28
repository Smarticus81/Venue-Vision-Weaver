import React from "react";
import { Heart, Image as ImageIcon, Download, Share2, Sparkles, Camera, ArrowRight, Menu } from "lucide-react";
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
            <a href="#" className="hover:text-[#111111] transition-colors">Galleries</a>
            <a href="#" className="hover:text-[#111111] transition-colors">Venues</a>
            <a href="#" className="hover:text-[#111111] transition-colors">Pricing</a>
            <a href="#" className="hover:text-[#111111] transition-colors">About</a>
          </nav>
          
          <div className="flex items-center gap-4">
            <Button variant="outline" className="hidden md:inline-flex rounded-full px-6 border-gray-200 hover:bg-gray-50 text-sm font-medium">
              Sign in
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center">
              
              {/* Left Column: Copy */}
              <div className="max-w-xl animate-fade-in-up">
                <h1 className="text-[3.5rem] md:text-[4.5rem] leading-[1.05] tracking-tighter font-extrabold text-[#111111] mb-6">
                  Every moment.<br/>
                  Beautifully kept.<br/>
                  <span className="text-gold">Forever yours.</span>
                </h1>
                
                <p className="text-lg md:text-xl text-gray-500 mb-10 max-w-lg leading-relaxed font-light">
                  A premium digital gallery experience for your wedding day. Relive the magic in high-resolution, shared effortlessly with everyone you love.
                </p>
                
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <Button className="w-full sm:w-auto bg-gold hover:bg-[#b09159] text-white rounded-full px-8 py-6 text-base font-medium transition-all shadow-lg shadow-[#C2A36B]/20">
                    Browse Galleries
                  </Button>
                  <Button variant="ghost" className="w-full sm:w-auto rounded-full px-8 py-6 text-base font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50 group">
                    For Venues <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </div>

              {/* Right Column: Image */}
              <div className="relative animate-fade-in-up delay-100 flex justify-center lg:justify-end">
                <div className="relative w-full max-w-[500px] aspect-square rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/5 border border-gray-50/50">
                  <img 
                    src="/__mockup/images/couple-venue-tour.png" 
                    alt="Couple touring a wedding venue" 
                    className="w-full h-full object-cover"
                  />
                  {/* Subtle vignette/overlay if needed */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none"></div>
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

        {/* Features Section */}
        <section className="py-24 md:py-32 bg-white">
          <div className="container mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-16 md:mb-24">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111111] mb-4">
                The perfect home for your memories
              </h2>
              <p className="text-gray-500 text-lg font-light">
                Designed to elegantly showcase the biggest day of your life without getting in the way.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
              {/* Feature 1 */}
              <div className="group rounded-3xl p-8 transition-all hover:bg-gray-50/50">
                <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] group-hover:scale-110 transition-transform">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-3 text-[#111111]">Your day, beautifully kept</h3>
                <p className="text-gray-500 font-light leading-relaxed">
                  A stunning digital gallery customized with your names and venue details. Relive the narrative of your day.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="group rounded-3xl p-8 transition-all hover:bg-gray-50/50">
                <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] group-hover:scale-110 transition-transform">
                  <Share2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-3 text-[#111111]">Share with every guest</h3>
                <p className="text-gray-500 font-light leading-relaxed">
                  A simple, secure link lets family and friends access the magic. No apps to download, no confusing logins.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="group rounded-3xl p-8 transition-all hover:bg-gray-50/50">
                <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf] group-hover:scale-110 transition-transform">
                  <Download className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-3 text-[#111111]">Download in full quality</h3>
                <p className="text-gray-500 font-light leading-relaxed">
                  Access original high-resolution photos and videos. Print them, frame them, keep them forever.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-24 bg-[#fdfbf7] border-y border-[#f5eedf]">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <Sparkles className="w-8 h-8 text-gold mx-auto mb-6" />
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-[#111111] mb-6">
              Ready to see the magic?
            </h2>
            <p className="text-xl text-gray-500 font-light mb-10 max-w-xl mx-auto">
              Ask your venue about Glimpse, or explore our public galleries to see how we preserve the best days.
            </p>
            <Button className="bg-[#111111] hover:bg-black text-white rounded-full px-10 py-7 text-lg font-medium transition-all shadow-xl shadow-black/10">
              Find My Gallery
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white py-12 border-t border-gray-100">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-gray-300">Glimpse</span>
          </div>
          
          <div className="flex gap-8 text-sm text-gray-400">
            <a href="#" className="hover:text-gold transition-colors">Privacy</a>
            <a href="#" className="hover:text-gold transition-colors">Terms</a>
            <a href="#" className="hover:text-gold transition-colors">Support</a>
            <a href="#" className="hover:text-gold transition-colors">For Venues</a>
          </div>
          
          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} Glimpse. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

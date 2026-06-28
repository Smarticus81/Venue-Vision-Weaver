import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, Search, Building2 } from "lucide-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex flex-col bg-white text-[#111111] font-sans">
      <header className="p-6 sm:p-10 flex items-center justify-center">
        <GlimpseLogo href="/" />
      </header>

      <main className="flex-1 flex items-center justify-center p-6 pb-24">
        <div className="w-full max-w-md bg-white rounded-3xl border border-gray-100 p-8 sm:p-10 shadow-xl shadow-black/5 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center mx-auto text-rose-500 border border-rose-100 mb-6">
            <AlertCircle className="h-8 w-8" />
          </div>
          
          <h1 className="font-playfair text-3xl mb-3 text-[#111111]">Page Not Found</h1>
          <p className="text-gray-500 font-light leading-relaxed mb-8">
            The page you're looking for doesn't exist or has moved.
          </p>
          
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => setLocation("/")}
              className="w-full h-12 bg-black hover:bg-gray-800 text-white rounded-full font-medium"
              data-testid="notfound-home"
            >
              <Home className="mr-2 h-4 w-4" /> Main site
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/find-my-gallery")}
              className="w-full h-12 rounded-full font-medium border-gray-200"
              data-testid="notfound-find-gallery"
            >
              <Search className="mr-2 h-4 w-4" /> Find my gallery
            </Button>
            <Button
              variant="ghost"
              onClick={() => setLocation("/create-venue")}
              className="w-full h-12 rounded-full text-gray-500 hover:text-[#111111]"
              data-testid="notfound-venues"
            >
              <Building2 className="mr-2 h-4 w-4" /> Venue sign up
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

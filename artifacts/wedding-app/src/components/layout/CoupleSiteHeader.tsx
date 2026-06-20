import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { Images } from "lucide-react";

export function CoupleSiteHeader() {
  const [, setLocation] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <GlimpseLogo href="/couple" className="h-12 sm:h-14" />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setLocation("/find-my-gallery")}
          data-testid="couple-header-find-gallery"
        >
          <Images className="mr-2 h-4 w-4" />
          Find my gallery
        </Button>
      </div>
    </header>
  );
}

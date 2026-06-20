import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { ArrowRight, LogIn } from "lucide-react";

interface VenueSiteHeaderProps {
  onSignIn?: () => void;
}

export function VenueSiteHeader({ onSignIn }: VenueSiteHeaderProps) {
  const [, setLocation] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <GlimpseLogo href="/" className="h-12 sm:h-14" />
        <p className="hidden sm:block text-xs tracking-[0.18em] uppercase text-muted-foreground">
          For wedding venues
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={onSignIn ?? (() => setLocation("/?owner=sign-in"))}
            data-testid="venue-header-sign-in"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign in
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground"
            onClick={() => setLocation("/create-venue")}
            data-testid="venue-header-register"
          >
            Register <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

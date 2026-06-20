import type { ReactNode } from "react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { cn } from "@/lib/utils";

type GlimpseShellProps = {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  narrow?: boolean;
};

export function GlimpseShell({ children, className, footer, narrow }: GlimpseShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/80 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <GlimpseLogo />
          <p className="hidden sm:block text-xs tracking-[0.2em] uppercase text-muted-foreground font-medium">
            A glimpse of your day
          </p>
        </div>
      </header>

      <main
        className={cn(
          "flex-1 w-full mx-auto px-4 sm:px-6 py-8 sm:py-12",
          narrow ? "max-w-3xl" : "max-w-6xl",
          className,
        )}
      >
        {children}
      </main>

      {footer ?? (
        <footer className="border-t border-border/80 py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <GlimpseLogo variant="mark" href="/" className="opacity-90" />
            <p className="serif text-base text-foreground/80">glimpse</p>
            <p className="text-xs tracking-wide">See yourselves at the venue before the day arrives.</p>
          </div>
        </footer>
      )}
    </div>
  );
}

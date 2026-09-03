import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="grain relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="mono-label mb-4 text-rose">404</p>
        <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">There's nothing at this address</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
          The link may be mistyped or the page has moved. Couples: your gallery link is in the email we sent you.
        </p>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
          <Button variant="rose" onClick={() => setLocation("/find-my-gallery")} className="h-12 px-6" data-testid="notfound-find-gallery">
            Find my gallery
          </Button>
          <Button variant="ghost" onClick={() => setLocation("/")} className="h-12 px-6 text-muted-foreground hover:text-foreground" data-testid="notfound-home">
            For venues
          </Button>
        </div>
      </main>
    </div>
  );
}

import { ChevronDown, LogOut, Plus } from "lucide-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { cn } from "@/lib/utils";

type VenueOption = { id: number; name: string; slug: string };

export function DashboardHeader({
  venues,
  selectedSlug,
  onSelectVenue,
  onAddVenue,
  onSignOut,
  userEmail,
}: {
  venues: VenueOption[];
  selectedSlug: string;
  onSelectVenue: (slug: string) => void;
  onAddVenue: () => void;
  onSignOut: () => void;
  userEmail?: string | null;
}) {
  const multi = venues.length > 1;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <GlimpseLogo href="/dashboard" className="text-[1.1rem] sm:text-[1.2rem]" />
          {multi && (
            <>
              <span aria-hidden className="h-4 w-px bg-border" />
              <label className="relative flex min-w-0 items-center">
                <span className="sr-only">Venue</span>
                <select
                  value={selectedSlug}
                  onChange={(e) => {
                    if (e.target.value === "__add") onAddVenue();
                    else onSelectVenue(e.target.value);
                  }}
                  className={cn(
                    "h-9 max-w-[11rem] appearance-none truncate rounded-md border border-border bg-background pl-3 pr-8 text-sm font-medium text-foreground",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[16rem]",
                  )}
                  data-testid="venue-switcher"
                >
                  {venues.map((v) => (
                    <option key={v.id} value={v.slug}>
                      {v.name}
                    </option>
                  ))}
                  <option value="__add">+ Add venue</option>
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground"
                />
              </label>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!multi && (
            <button
              type="button"
              onClick={onAddVenue}
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            >
              <Plus className="h-4 w-4" /> Add venue
            </button>
          )}
          {userEmail && (
            <span className="hidden max-w-[14rem] truncate px-2 text-xs text-muted-foreground md:block" title={userEmail}>
              {userEmail}
            </span>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="dashboard-sign-out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sr-only sm:hidden">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}

import { Link } from "wouter";
import { cn } from "@/lib/utils";

type GlimpseLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  href?: string;
};

/** Existing brand mark, presented in the garden palette. */
function ViewfinderMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("h-[1.35em] w-[1.35em] shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M4 10 V6.5 A2.5 2.5 0 0 1 6.5 4 H10" />
      <path d="M22 4 H25.5 A2.5 2.5 0 0 1 28 6.5 V10" />
      <path d="M28 22 V25.5 A2.5 2.5 0 0 1 25.5 28 H22" />
      <path d="M10 28 H6.5 A2.5 2.5 0 0 1 4 25.5 V22" />
      <circle
        cx="16"
        cy="16"
        r="4.6"
        fill="hsl(var(--primary))"
        stroke="none"
      />
    </svg>
  );
}

export function GlimpseLogo({
  variant = "full",
  className,
  href = "/",
}: GlimpseLogoProps) {
  const logo = (
    <span
      className={cn(
        "inline-flex items-center gap-2 leading-none text-foreground select-none",
        className,
      )}
    >
      <ViewfinderMark
        className={
          variant === "full"
            ? "text-foreground"
            : "text-foreground h-[1.5em] w-[1.5em]"
        }
      />
      {variant === "full" && (
        <span className="font-sans text-[1.6rem] font-semibold tracking-tight lowercase">
          glimpse
        </span>
      )}
    </span>
  );

  if (!href) return logo;
  return (
    <Link
      href={href}
      aria-label="glimpse home"
      className="inline-flex min-h-11 items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      {logo}
    </Link>
  );
}

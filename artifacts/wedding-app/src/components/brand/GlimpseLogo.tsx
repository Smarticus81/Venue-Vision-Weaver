import { Link } from "wouter";
import { cn } from "@/lib/utils";

type GlimpseLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  href?: string;
};

export function GlimpseLogo({ variant = "full", className, href = "/" }: GlimpseLogoProps) {
  const wordmark = (
    <span
      className={cn(
        "font-bold tracking-tight leading-none text-foreground select-none",
        variant === "full" ? "text-2xl" : "text-xl",
        className,
      )}
    >
      Glimpse<span className="text-gold">.</span>
    </span>
  );

  if (!href) return wordmark;
  return (
    <Link href={href} className="inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
      {wordmark}
    </Link>
  );
}

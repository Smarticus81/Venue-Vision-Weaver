import { Link } from "wouter";
import { cn } from "@/lib/utils";

type GlimpseLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  href?: string;
};

export function GlimpseLogo({ variant = "full", className, href = "/" }: GlimpseLogoProps) {
  const img = (
    <img
      src={variant === "mark" ? "/brand/glimpse-logo-rose.png" : "/brand/glimpse-logo.png"}
      alt="glimpse"
      className={cn(
        variant === "full" ? "h-14 sm:h-16 w-auto object-contain" : "h-10 w-10 object-contain",
        className,
      )}
    />
  );

  if (!href) return img;
  return (
    <Link href={href} className="inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
      {img}
    </Link>
  );
}

import { Link } from "wouter";
import { logoAssetUrl, LOGO_DIMENSIONS, type LogoPart } from "@workspace/brand";
import { cn } from "@/lib/utils";

type DreemerLogoProps = {
  variant?: LogoPart;
  /** Mono inherits currentColor through the exact artwork's alpha mask. */
  tone?: "color" | "mono" | "reversed";
  className?: string;
  href?: string | null;
};

/** The actual OpenAI-generated logo artwork, fetched as an independently cached asset. */
export function DreemerLogo({ variant = "lockup", tone = "color", className, href = "/" }: DreemerLogoProps) {
  const [width, height] = LOGO_DIMENSIONS[variant];
  const asset = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${logoAssetUrl(variant, tone === "reversed" ? "reversed" : "ink")}`;
  const sizing = variant === "lockup" ? "h-[1.5em]" : variant === "mark" ? "h-[1.15em]" : "h-[1em]";
  const logo = <span className={cn("inline-flex items-center text-[1.5rem] leading-none text-foreground select-none", className)}>
    {tone === "mono" ? <span aria-hidden="true" className={cn("inline-block bg-current", sizing)} style={{ aspectRatio: `${width} / ${height}`, maskImage: `url("${asset}")`, WebkitMaskImage: `url("${asset}")`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }} />
      : <img src={asset} width={width} height={height} alt="" aria-hidden="true" draggable={false} className={cn("w-auto object-contain", sizing)} />}
    <span className="sr-only">Dreemer</span>
  </span>;
  if (!href) return logo;
  return <Link href={href} aria-label="Dreemer home" className="inline-flex min-h-11 items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">{logo}</Link>;
}

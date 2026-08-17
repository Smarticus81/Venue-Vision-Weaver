import { cn } from "@/lib/utils";
import { MOOD_LABELS, MOOD_ORDER, type MoodKey } from "./moods";

/** The signature control: re-light the venue. Shared by the hero and
 * the descent's arrival bar (compact hides the framing copy). */
export function MoodDial({
  mood,
  onMood,
  className,
  compact = false,
}: {
  mood: MoodKey;
  onMood: (m: MoodKey) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={className}>
      {!compact && (
        <p className="lp-eyebrow mb-3 text-foreground/55">See your venue in another light</p>
      )}
      <div
        role="group"
        aria-label="Scene lighting"
        className="inline-flex rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur-md"
      >
        {MOOD_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mood === m}
            onClick={() => onMood(m)}
            className={cn(
              "rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
              mood === m ? "" : "text-foreground/60 hover:text-foreground",
            )}
            style={
              mood === m
                ? { background: "var(--lp-accent)", color: "var(--lp-accent-ink)" }
                : undefined
            }
          >
            {MOOD_LABELS[m]}
          </button>
        ))}
      </div>
      {!compact && (
        <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-foreground/50">
          That's the product: couples see themselves at your venue, in the
          light they're imagining.
        </p>
      )}
    </div>
  );
}

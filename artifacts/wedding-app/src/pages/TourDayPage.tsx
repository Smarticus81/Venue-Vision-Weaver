import { useParams } from "wouter";
import { FormLayout } from "@/components/layout/SiteChrome";

/**
 * Step-0 stub for tour-day mode (/dashboard/tour/:slug). The owner-funnel
 * workstream (WS-E2) replaces this with the phone-first capture flow.
 */
export default function TourDayPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <FormLayout
      label="Tour-day mode"
      title="Tour-day mode is being built"
      description="A phone-first way to make a couple's gallery during the tour itself is on its way."
    >
      <p className="text-sm text-muted-foreground">
        Venue: <span className="font-mono text-foreground">{slug}</span>
      </p>
    </FormLayout>
  );
}

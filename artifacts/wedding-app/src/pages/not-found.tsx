import { Link } from "wouter";
import { FormLayout } from "@/components/layout/SiteChrome";
export default function NotFound() {
  return (
    <FormLayout
      label="404 · A little off course"
      title="Let’s find your way back."
      description="This page has moved, or the link isn’t quite right."
    >
      <h2>Where would you like to go?</h2>
      <div className="grid gap-3">
        <Link href="/" className="action-primary" data-testid="notfound-home">
          Explore glimpse
        </Link>
        <Link
          href="/find-my-gallery"
          className="text-link"
          data-testid="notfound-find-gallery"
        >
          Find my gallery →
        </Link>
        <Link
          href="/create-venue"
          className="text-link"
          data-testid="notfound-venues"
        >
          Create a venue →
        </Link>
      </div>
    </FormLayout>
  );
}

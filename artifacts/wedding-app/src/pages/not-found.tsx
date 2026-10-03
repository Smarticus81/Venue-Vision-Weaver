import { Link } from "wouter";
import { FormLayout } from "@/components/layout/SiteChrome";

export default function NotFound() {
  return (
    <FormLayout
      label="404"
      title="That page isn't here."
      description="The link may have changed, or it was typed in wrong."
    >
      <h2>Where to next?</h2>
      <div className="grid gap-3">
        <Link href="/" className="action-primary" data-testid="notfound-home">
          Dreemer for venues
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

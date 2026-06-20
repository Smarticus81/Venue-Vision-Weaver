import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, Search, Building2 } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="glass w-full max-w-md border-border">
        <CardContent className="pt-8 pb-6 text-center space-y-5">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="serif text-3xl mb-2">Page Not Found</h1>
            <p className="text-muted-foreground text-sm">
              The page you're looking for doesn't exist or has moved.
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={() => setLocation("/")}
              className="w-full bg-primary text-primary-foreground"
              data-testid="notfound-home"
            >
              <Home className="mr-2 h-4 w-4" /> Main site
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/find-my-gallery")}
              className="w-full"
              data-testid="notfound-find-gallery"
            >
              <Search className="mr-2 h-4 w-4" /> Find my gallery
            </Button>
            <Button
              variant="ghost"
              onClick={() => setLocation("/create-venue")}
              className="w-full text-muted-foreground"
              data-testid="notfound-venues"
            >
              <Building2 className="mr-2 h-4 w-4" /> Venue sign up
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

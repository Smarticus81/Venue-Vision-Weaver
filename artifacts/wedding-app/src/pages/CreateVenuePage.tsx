import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateVenue, type ErrorEnvelope, type ErrorType } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { VenueSiteHeader } from "@/components/layout/VenueSiteHeader";

export default function CreateVenuePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createVenue = useCreateVenue();

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    tagline: "",
    description: "",
    ownerEmail: "",
    contactEmail: "",
    contactPhone: "",
    websiteUrl: "",
    bookingUrl: "",
  });

  const [isSlugEdited, setIsSlugEdited] = useState(false);

  useEffect(() => {
    if (!isSlugEdited) {
      const slug = formData.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
      setFormData(prev => ({ ...prev, slug }));
    }
  }, [formData.name, isSlugEdited]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.ownerEmail.trim())) {
      toast({
        title: "Owner email required",
        description: "Use the email address that should receive secure profile login links.",
        variant: "destructive"
      });
      return;
    }

    createVenue.mutate({
      data: {
        name: formData.name,
        slug: formData.slug,
        tagline: formData.tagline || undefined,
        description: formData.description || undefined,
        ownerEmail: formData.ownerEmail.trim().toLowerCase(),
        contactEmail: formData.contactEmail.trim() || undefined,
        contactPhone: formData.contactPhone.trim() || undefined,
        websiteUrl: formData.websiteUrl.trim() || undefined,
        bookingUrl: formData.bookingUrl.trim() || undefined,
      }
    }, {
      onSuccess: (venue) => {
        toast({
          title: "Venue Created!",
          description: `Welcome to ${venue.name}. Check your email for a secure profile login link.`,
        });
        void fetch("/api/owners/login-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: formData.ownerEmail.trim().toLowerCase() }),
        });
        setLocation(`/profile/${venue.slug}`);
      },
      onError: (error: ErrorType<ErrorEnvelope>) => {
        toast({
          title: "Creation Failed",
          description: error.data?.error ?? "An unexpected error occurred",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <VenueSiteHeader />
      <div className="flex-1 flex items-center justify-center p-4 relative">
      <Button 
        variant="ghost" 
        className="absolute top-4 left-4 sm:left-8 text-muted-foreground hover:text-foreground"
        onClick={() => setLocation("/")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl"
      >
        <Card className="glass border-border shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="serif text-3xl mb-2">Register Your Venue</CardTitle>
            <CardDescription className="font-light text-muted-foreground">
              Create your glimpse venue profile and couple gallery link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Venue Name</Label>
                  <Input
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="bg-background/50 border-border"
                    placeholder="Grand Palace Resort"
                    data-testid="venue-name-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slug">Venue URL Slug</Label>
                  <Input
                    id="slug"
                    required
                    value={formData.slug}
                    onChange={(e) => {
                      setIsSlugEdited(true);
                      setFormData(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }));
                    }}
                    className="bg-background/50 border-border font-mono text-sm"
                    placeholder="grand-palace"
                    data-testid="venue-slug-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tagline">Tagline (Optional)</Label>
                <Input
                  id="tagline"
                  value={formData.tagline}
                  onChange={(e) => setFormData(prev => ({ ...prev, tagline: e.target.value }))}
                  className="bg-background/50 border-border"
                  placeholder="Where dreams find a home"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="bg-background/50 border-border min-h-[100px]"
                  placeholder="Describe the architecture, atmosphere, ceremony spaces, and what couples should feel here..."
                />
              </div>

              <motion.div className="space-y-2">
                <Label htmlFor="ownerEmail">Owner Email</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  required
                  value={formData.ownerEmail}
                  onChange={(e) => setFormData((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                  className="bg-background/50 border-border"
                  placeholder="owner@venue.com"
                  data-testid="venue-owner-email-input"
                />
                <p className="text-xs text-muted-foreground">
                  We will use this for secure profile links, billing, and couple session notifications.
                </p>
              </motion.div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Public Inquiry Email (Optional)</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData((prev) => ({ ...prev, contactEmail: e.target.value }))}
                    className="bg-background/50 border-border"
                    placeholder="events@venue.com"
                    data-testid="venue-contact-email-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Public Phone (Optional)</Label>
                  <Input
                    id="contactPhone"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData((prev) => ({ ...prev, contactPhone: e.target.value }))}
                    className="bg-background/50 border-border"
                    placeholder="(555) 123-4567"
                    data-testid="venue-contact-phone-input"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="websiteUrl">Website URL (Optional)</Label>
                  <Input
                    id="websiteUrl"
                    value={formData.websiteUrl}
                    onChange={(e) => setFormData((prev) => ({ ...prev, websiteUrl: e.target.value }))}
                    className="bg-background/50 border-border"
                    placeholder="https://yourvenue.com"
                    data-testid="venue-website-url-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bookingUrl">Tour Booking URL (Optional)</Label>
                  <Input
                    id="bookingUrl"
                    value={formData.bookingUrl}
                    onChange={(e) => setFormData((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                    className="bg-background/50 border-border"
                    placeholder="https://yourvenue.com/tours"
                    data-testid="venue-booking-url-input"
                  />
                </div>
              </div>


              <Button 
                type="submit" 
                className="w-full h-12 text-lg bg-primary text-primary-foreground hover:bg-primary/90 mt-4" 
                disabled={createVenue.isPending}
                data-testid="create-venue-submit"
              >
                {createVenue.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Creating...
                  </>
                ) : (
                  "Launch Venue Dashboard"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
      </div>
    </div>
  );
}

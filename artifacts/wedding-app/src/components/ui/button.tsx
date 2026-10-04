import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button vocabulary (see BRAND.md):
 *  - default / brand: the coral primary action — ink text on coral, one per view.
 *  - outline: ink hairline, for the secondary action beside a primary.
 *  - secondary: soft ivory fill, for quiet in-page actions.
 *  - ghost: text-only, for toolbars and tertiary actions.
 *  - destructive: error fill, white text.
 *  - link: sea text link.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-brand-hover",
        brand: "bg-primary text-primary-foreground hover:bg-brand-hover",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        outline: "border border-foreground/80 bg-transparent text-foreground hover:bg-soft",
        secondary: "bg-soft text-foreground hover:bg-border",
        ghost: "bg-transparent text-foreground/80 hover:bg-soft hover:text-foreground",
        link: "text-secondary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5 py-3",
        sm: "min-h-10 px-4 text-xs",
        lg: "min-h-13 px-7 py-3 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };

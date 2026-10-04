import React from "react";
export const ClerkProvider = ({ children }) => children;
const onAuthPage = () =>
  typeof window !== "undefined" && window.location.pathname === "/login";
export const SignedIn = ({ children }) => (onAuthPage() ? null : children);
export const SignedOut = ({ children }) => (onAuthPage() ? children : null);
export const useUser = () => ({
  isLoaded: true,
  isSignedIn: true,
  user: {
    fullName: "Demo venue team",
    primaryEmailAddress: { emailAddress: "team@example.test" },
  },
});
export const useClerk = () => ({ signOut: () => {} });
export const useOrganization = () => ({
  isLoaded: true,
  organization: { id: "demo" },
});
export const useOrganizationList = () => ({
  isLoaded: true,
  userMemberships: { data: [] },
});
export const CreateOrganization = () => null;
export const SignUp = () => null;
/** Static stand-in for the hosted Clerk widget so the sign-in page shell can be reviewed. */
export const SignIn = () => (
  <form
    aria-label="Sign in (fixture)"
    onSubmit={(e) => e.preventDefault()}
    style={{ display: "grid", gap: 12, fontFamily: "inherit" }}
  >
    <label style={{ display: "grid", gap: 6 }}>
      Email address
      <input type="email" placeholder="you@yourvenue.com" style={{ font: "inherit", padding: "12px 14px", border: "1px solid currentColor", borderRadius: 8, background: "transparent" }} />
    </label>
    <label style={{ display: "grid", gap: 6 }}>
      Password
      <input type="password" placeholder="••••••••" style={{ font: "inherit", padding: "12px 14px", border: "1px solid currentColor", borderRadius: 8, background: "transparent" }} />
    </label>
    <button type="submit" className="action-primary">Continue</button>
  </form>
);

export const ClerkLoaded = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const ClerkLoading = () => null;
export const ClerkFailed = () => null;

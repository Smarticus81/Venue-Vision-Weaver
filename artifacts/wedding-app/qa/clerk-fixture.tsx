import React from "react";
export const ClerkProvider = ({ children }) => children;
export const SignedIn = ({ children }) => children;
export const SignedOut = () => null;
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
export const SignIn = () => null;

import { useUser } from "@clerk/clerk-react";
import { getGetOperatorAccessQueryKey, useGetOperatorAccess } from "@workspace/api-client-react";
import { clerkConfigured } from "@/lib/clerk";

/**
 * True when the signed-in Clerk user is a control-plane operator (their
 * verified email is in CONTROL_PLANE_OPERATOR_EMAILS). Drives the Control
 * link; the /control routes still check every request on the server.
 * Without Clerk there is no provider to read, so it is always false.
 */
export const useIsOperator: () => boolean = clerkConfigured ? useIsOperatorWithClerk : () => false;

function useIsOperatorWithClerk(): boolean {
  const { isLoaded, isSignedIn, user } = useUser();
  const signedIn = Boolean(isLoaded && isSignedIn && user);
  const access = useGetOperatorAccess({
    query: {
      // Keyed by user so switching accounts in one tab never reuses an answer.
      queryKey: [...getGetOperatorAccessQueryKey(), user?.id ?? "signed-out"],
      enabled: signedIn,
      staleTime: 5 * 60_000,
      retry: false,
    },
  });
  return signedIn && access.data?.operator === true;
}

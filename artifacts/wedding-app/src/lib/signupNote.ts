/**
 * The signup aside. The free trial is granted once per person (Clerk user):
 * someone who already belongs to an organization has most likely used it,
 * and a new organization of theirs starts without trial credits, so the page
 * must not promise free galleries to them.
 */
export function signupTrialNote(input: {
  trialCredits: number;
  trialDays: number;
  hasExistingOrganization: boolean;
}): { heading: string; body: string } {
  if (input.hasExistingOrganization) {
    return {
      heading: "Credits come from your plan",
      body: "The free trial is once per person. A new business starts on your own plan or a credit pack; credits are shared across every venue you add to it.",
    };
  }
  return {
    heading: `${input.trialCredits} galleries free`,
    body: `Enough to run it at the end of this week's tours and see how couples respond. ${input.trialDays} days, no card needed to start.`,
  };
}

import { Redirect } from "wouter";

/** Legacy couple entry URL - the couple home lives at /couple. */
export default function CoupleEntryPage() {
  return <Redirect to="/couple" />;
}

import { redirect } from "next/navigation";
import { authSession } from "~/server/auth";
import { safeAuthDestination } from "~/lib/auth-destination";
import TwoFactorChallenge from "../_components/auth/two-factor-challenge";

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const destination = safeAuthDestination((await searchParams).next);
  const session = await authSession();
  if (!session) redirect("/login");
  if (!session.twoFactorRequired) redirect(destination);
  return <TwoFactorChallenge session={session} destination={destination} />;
}

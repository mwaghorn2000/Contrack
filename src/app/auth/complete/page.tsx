import { redirect } from "next/navigation";
import { authSession } from "~/server/auth";
import { safeAuthDestination } from "~/lib/auth-destination";

export default async function CompleteSignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const destination = safeAuthDestination((await searchParams).next);
  const session = await authSession();
  if (!session) redirect("/login");
  if (session.twoFactorRequired)
    redirect(`/two-factor?next=${encodeURIComponent(destination)}`);
  redirect(destination);
}

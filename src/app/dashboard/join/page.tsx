import { auth } from "~/server/auth";
import PendingInvitations from "~/app/_components/invitations/pending-invitations";

export default async function JoinCompanyPage() {
  const session = await auth();
  return <PendingInvitations email={session?.user.email ?? null} />;
}

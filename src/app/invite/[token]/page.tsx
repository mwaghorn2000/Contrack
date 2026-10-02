import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authSession } from "~/server/auth";
import { db } from "~/server/db";
import { hashInvitationToken } from "~/server/invitations";
import { authPath, invitationToken } from "~/lib/invitation-links";
import AcceptInvitation from "~/app/_components/invitations/accept-invitation";

export const metadata: Metadata = {
  title: "Company invitation | Contrack",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const token = invitationToken((await params).token);
  const invitation = token
    ? await db.companyInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
        select: {
          email: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          company: { select: { name: true } },
        },
      })
    : null;
  if (
    !token ||
    !invitation ||
    invitation.revokedAt ||
    invitation.acceptedAt ||
    invitation.expiresAt <= new Date()
  ) {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <p>
          This invitation has expired, was revoked, or has already been
          accepted. Ask the company administrator for a new invitation.
        </p>
        <Link href="/dashboard" className="inline-block underline">
          Go to your dashboard
        </Link>
      </main>
    );
  }
  const session = await authSession();
  if (session?.twoFactorRequired)
    redirect(`/two-factor?next=${encodeURIComponent(`/invite/${token}`)}`);
  if (!session?.user?.id)
    redirect(authPath("/signup", token, invitation.email));
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true },
  });
  if (!user) redirect(authPath("/signup", token, invitation.email));

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center p-6">
      <AcceptInvitation
        token={token}
        companyName={invitation.company.name}
        role={invitation.role}
        invitedEmail={invitation.email}
        currentEmail={user.email}
        verified={!!user.emailVerified}
        expiresAt={invitation.expiresAt.toISOString()}
      />
    </main>
  );
}

import "server-only";

import { Resend } from "resend";
import { env } from "~/env";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(email: string, code: string) {
  const { error } = await resend.emails.send({
    from: "Contrack <accounts@auth.contrack.au>",
    to: email,
    subject: "Verify your Contrack email",
    text: `Your Contrack verification code is: ${code}`,
  });

  if (error) {
    throw new Error("Unable to send verification email.");
  }
}

export async function sendCompanyInvitationEmail(input: {
  email: string;
  companyName: string;
  role: string;
  token: string;
  expiresAt: Date;
}) {
  const origin =
    env.APP_URL ??
    (env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);
  if (
    !origin ||
    (env.NODE_ENV === "production" && new URL(origin).protocol !== "https:")
  ) {
    throw new Error("Set APP_URL to the public HTTPS application URL.");
  }
  const link = new URL(`/invite/${input.token}`, origin).toString();
  const { error } = await resend.emails.send({
    from: "Contrack <accounts@auth.contrack.au>",
    to: input.email,
    subject: "You have been invited to a company on Contrack",
    text: `You have been invited to join ${input.companyName} as a ${input.role.toLowerCase()}.\n\nAccept your invitation: ${link}\n\nNo account yet? You can create one using ${input.email}.\n\nThis invitation expires at ${input.expiresAt.toISOString()} and can only be used once. If you were not expecting this invitation, you can ignore it.`,
  });
  if (error) throw new Error("Unable to send invitation email.");
}

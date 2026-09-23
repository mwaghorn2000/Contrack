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

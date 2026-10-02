import NextAuth from "next-auth";
import { cache } from "react";

import { authConfig } from "./config";

const { auth: uncachedAuth, handlers, signIn, signOut } = NextAuth(authConfig);

// Only the sign-in completion pages may see sessions awaiting their second factor.
const authSession = cache(() => uncachedAuth());
const auth = cache(async () => {
  const session = await authSession();
  return session?.twoFactorRequired ? null : session;
});

export { auth, authSession, handlers, signIn, signOut };

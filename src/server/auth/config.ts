import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import { env } from "~/env";
import Credentials from "next-auth/providers/credentials";
import * as argon2 from "argon2";
import { z } from "zod";
import { CredentialsSignin } from "next-auth";

import { db } from "~/server/db";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(1)
    .refine((password) => [...password].length <= 128),
});

class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    DiscordProvider,
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);

        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user?.passwordHash) return null;

        const passwordMatches = await argon2.verify(
          user.passwordHash,
          parsed.data.password,
        );

        if (!passwordMatches) return null;

        if (user.emailVerified === null) {
          throw new EmailNotVerifiedError();
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  adapter: PrismaAdapter(db),
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }

      return token;
    },

    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
} satisfies NextAuthConfig;

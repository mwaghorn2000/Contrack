"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";

export default function GoogleSignInButton() {
  async function handleGoogleLogin() {
    await signIn("google", {
      redirectTo: "/dashboard",
    });
  }

  return (
    <button
      type="button"
      onClick={handleGoogleLogin}
      className="flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 shadow-xs transition hover:border-gray-400 hover:bg-gray-50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99]"
    >
      <Image
        src="/google-g.png"
        alt=""
        aria-hidden="true"
        width={20}
        height={20}
        className="shrink-0"
      />
      <span>Continue with Google</span>
    </button>
  );
}

import Link from "next/link";

import AuthLayout from "../_components/auth/auth-layout";
import GoogleSignInButton from "../_components/auth/google-sign-in-button";

export default function LoginPage() {
  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to continue to your account"
    >
      <form className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email
          </label>

          <input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700"
          >
            Password
          </label>

          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-black px-4 py-2.5 font-medium text-white transition hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-none active:scale-[0.99]"
        >
          Sign in
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />

        <span className="text-sm font-medium text-gray-400">or</span>

        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <GoogleSignInButton />

      <div className="mt-6 flex items-center justify-center gap-1 text-sm">
        <span className="text-gray-500">Don&apos;t have an account?</span>
        <Link
          href="/signup"
          className="rounded-sm font-medium text-gray-900 underline-offset-4 hover:underline focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 focus:outline-none"
        >
          Sign up
        </Link>
      </div>
    </AuthLayout>
  );
}

import Link from "next/link";

import { auth } from "~/server/auth";
import CompanySelector from "./company-selector";
import ProfilePicture from "./profile-picture";

export default async function TopNavBar() {
  const session = await auth();
  const displayName = session?.user?.name ?? session?.user?.email ?? "Account";

  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:gap-6 sm:px-6 lg:px-8">
      <Link
        href="/dashboard"
        className="shrink-0 rounded text-lg font-semibold tracking-tight text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-900"
      >
        Contrack
      </Link>

      {session?.user && (
        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto">
          <CompanySelector />
        </div>
      )}

      <nav
        aria-label="Main navigation"
        className="hidden items-center gap-6 lg:flex"
      >
        <Link
          href="/dashboard"
          className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
        >
          Dashboard
        </Link>
      </nav>

      {session?.user && (
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-sm text-gray-600 md:block">
            {displayName}
          </span>
          <ProfilePicture />
        </div>
      )}
    </header>
  );
}

import Link from "next/link";
import { Suspense } from "react";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import CompanySelector from "./company-selector";
import AccountMenu from "./account-menu";

export default async function TopNavBar() {
  const session = await auth();
  // Profile edits can be newer than the name stored in the login token.
  const user = session?.user.id
    ? await db.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, email: true, image: true },
      })
    : null;
  const displayName = user?.name ?? user?.email ?? "Account";

  return (
    <header className="relative z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:gap-6 sm:px-6 lg:px-8">
      <Link
        href="/dashboard"
        className="shrink-0 rounded text-lg font-semibold tracking-tight text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gray-900"
      >
        Contrack.
      </Link>

      {user && (
        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto">
          <Suspense
            fallback={
              <div
                role="status"
                className="flex h-10 w-full items-center rounded-md border border-gray-300 px-3 text-sm text-gray-500 sm:w-48"
              >
                Loading companies…
              </div>
            }
          >
            <CompanySelector />
          </Suspense>
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

      {user && (
        <Suspense
          fallback={
            <span className="ml-auto text-sm text-gray-600">{displayName}</span>
          }
        >
          <AccountMenu name={user.name} email={user.email} image={user.image} />
        </Suspense>
      )}
    </header>
  );
}

import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import Sidebar from "../_components/_dashboard-components/sidebar";
import TopNavBar from "../_components/_dashboard-components/top-navbar";
import CompanyAccessNotice from "../_components/_dashboard-components/company-access-notice";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col md:h-dvh md:min-h-0 md:overflow-hidden">
      <TopNavBar />
      <div className="flex flex-1 flex-col md:min-h-0 md:flex-row md:overflow-hidden">
        <Suspense
          fallback={
            <aside className="w-full shrink-0 border-b border-gray-200 bg-gray-50 p-4 md:w-60 md:border-r md:border-b-0">
              <p role="status" className="px-3 py-2 text-sm text-gray-500">
                Loading navigation…
              </p>
            </aside>
          }
        >
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1 p-6 md:min-h-0 md:overflow-y-auto">
          <Suspense fallback={null}>
            <CompanyAccessNotice />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

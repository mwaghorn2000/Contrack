import type React from "react";
import Sidebar from "../_components/_dashboard-components/sidebar";
import TopNavBar from "../_components/_dashboard-components/top-navbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNavBar />
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

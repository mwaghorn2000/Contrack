import type React from "react";
import Sidebar from "../_components/_dashboard-components/sidebar";
import TopNavBar from "../_components/_dashboard-components/top-navbar";

export default async function DashboardLayout({
    children
} : {
    children: React.ReactNode;
}) {
    return (
        <div>
            <div className="flex min-h-screen">
                <Sidebar />

                <div className="flex flex-1 flex-col">
                    <TopNavBar />
                    <main className="flex-1 p-6">{children}</main>
                </div>
            </div>
        </div>
    )
}
// src/app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import HomePage from "./home/page";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <HomePage searchParams={searchParams} />;
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function CompanyAccessNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("notice") !== "company-unavailable") return null;

  return (
    <p
      role="status"
      className="mx-auto mb-6 max-w-[1000px] rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      That company is no longer available to your account. You can select
      another company or{" "}
      <Link href="/dashboard/join" className="font-medium underline">
        join a company
      </Link>
      .
    </p>
  );
}

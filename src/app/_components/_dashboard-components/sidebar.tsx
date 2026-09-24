"use client";

import { skipToken } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { api } from "~/trpc/react";

const upcomingPages = ["Jobs", "Company Chat", "DMs", "People"];
const placeholderClass =
  "flex w-full cursor-not-allowed items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-gray-500";

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId");
  const companies = api.company.listCompanies.useQuery();
  const selectedCompany = companies.data?.find(
    (company) => company.id === companyId,
  );
  const jobs = api.job.listCompanyJobs.useQuery(
    selectedCompany ? { companyId: selectedCompany.id } : skipToken,
  );
  const role = selectedCompany?.members[0]?.role;
  const canAddJob = role === "OWNER" || role === "ADMIN";
  const homeHref = selectedCompany
    ? `/dashboard?${new URLSearchParams({ companyId: selectedCompany.id }).toString()}`
    : "/dashboard";

  return (
    <aside className="w-full shrink-0 border-b border-gray-200 bg-gray-50 p-4 md:w-60 md:border-r md:border-b-0">
      <nav aria-label="Sidebar navigation" className="space-y-1">
        <Link
          href={homeHref}
          aria-current={pathname === "/dashboard" ? "page" : undefined}
          className={`block rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 ${
            pathname === "/dashboard"
              ? "bg-gray-200 text-gray-900"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          Home
        </Link>
        {upcomingPages.map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className={placeholderClass}
          >
            {label}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="sidebar-jobs"
        className="mt-6 border-t border-gray-200 pt-5"
      >
        <h2
          id="sidebar-jobs"
          className="px-3 text-xs font-semibold tracking-wide text-gray-500 uppercase"
        >
          Company jobs
        </h2>
        {selectedCompany && (
          <p
            className="mt-1 truncate px-3 text-sm font-medium text-gray-900"
            title={selectedCompany.name}
          >
            {selectedCompany.name}
          </p>
        )}
        <div className="mt-3">
          {companies.isPending ? (
            <p role="status" className="px-3 text-sm text-gray-500">
              Loading companies…
            </p>
          ) : companies.isError ? (
            <div className="px-3 text-sm text-gray-600">
              <p role="status">Couldn’t load companies.</p>
              <button
                type="button"
                onClick={() => void companies.refetch()}
                className="mt-2 rounded underline"
              >
                Retry
              </button>
            </div>
          ) : !selectedCompany ? (
            <p className="px-3 text-sm text-gray-500">
              {companyId
                ? "Select an available company to see its jobs."
                : "Select a company to see its jobs."}
            </p>
          ) : jobs.isPending ? (
            <p role="status" className="px-3 text-sm text-gray-500">
              Loading jobs…
            </p>
          ) : jobs.isError ? (
            <div className="px-3 text-sm text-gray-600">
              <p role="status">Couldn’t load jobs.</p>
              <button
                type="button"
                onClick={() => void jobs.refetch()}
                className="mt-2 rounded underline"
              >
                Retry
              </button>
            </div>
          ) : jobs.data.length === 0 ? (
            <p className="px-3 text-sm text-gray-500">No jobs yet.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {jobs.data.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    disabled
                    title={job.title}
                    className={placeholderClass}
                  >
                    <span className="truncate">{job.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canAddJob && (
          <button
            type="button"
            disabled
            className="mt-4 flex w-full cursor-not-allowed items-center justify-between gap-3 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500"
          >
            <span>+ Add job</span>
          </button>
        )}
      </section>
    </aside>
  );
}

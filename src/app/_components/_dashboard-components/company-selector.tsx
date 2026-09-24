"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { api } from "~/trpc/react";
import CreateCompanyModal from "./create-company-modal";

export default function CompanySelector() {
  const {
    data: companies,
    isPending,
    isError,
    refetch,
  } = api.company.listCompanies.useQuery();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSwitching, startTransition] = useTransition();
  const [isCreating, setIsCreating] = useState(false);
  const dropdownRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const companyId = searchParams.get("companyId");
  const selectedCompany = companies?.find(
    (company) => company.id === companyId,
  );

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !dropdownRef.current?.contains(event.target)
      ) {
        dropdownRef.current?.removeAttribute("open");
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dropdownRef.current?.open) {
        dropdownRef.current.removeAttribute("open");
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function selectCompany(id: string) {
    dropdownRef.current?.removeAttribute("open");
    triggerRef.current?.focus();
    const params = new URLSearchParams(searchParams.toString());
    params.set("companyId", id);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function closeModal() {
    setIsCreating(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="w-full min-w-0 sm:w-48">
      <details
        ref={dropdownRef}
        className="group/company relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            event.currentTarget.removeAttribute("open");
          }
        }}
      >
        <summary
          ref={triggerRef}
          aria-label={`Company: ${selectedCompany?.name ?? "Select company"}`}
          className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 [&::-webkit-details-marker]:hidden"
        >
          <span className="truncate">
            {isPending
              ? "Loading companies…"
              : (selectedCompany?.name ??
                (companies?.length
                  ? "Select company"
                  : isError
                    ? "Companies unavailable"
                    : "No companies yet"))}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 shrink-0 text-gray-500 transition-transform duration-200 ease-in-out group-open/company:rotate-180 motion-reduce:transition-none"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div
          className="absolute left-0 z-30 mt-2 w-full min-w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
          aria-busy={isSwitching}
        >
          <div className="max-h-64 overflow-y-auto">
            {isPending ? (
              <p role="status" className="px-3 py-2 text-sm text-gray-500">
                Loading companies…
              </p>
            ) : isError ? (
              <div className="px-3 py-2 text-sm text-gray-600">
                <p role="status">Couldn’t load companies.</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-1 rounded underline"
                >
                  Retry
                </button>
              </div>
            ) : companies?.length ? (
              companies.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  aria-pressed={company.id === companyId}
                  disabled={isSwitching}
                  onClick={() => selectCompany(company.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 disabled:opacity-50"
                >
                  <span className="truncate">{company.name}</span>
                  {company.id === companyId && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4 shrink-0 text-gray-700"
                    >
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-gray-500">
                No companies yet
              </p>
            )}
          </div>
          <div className="mt-1 border-t border-gray-200 pt-1">
            <button
              type="button"
              onClick={() => {
                dropdownRef.current?.removeAttribute("open");
                triggerRef.current?.focus();
                setIsCreating(true);
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 focus-visible:bg-gray-100"
            >
              + Create company
            </button>
          </div>
        </div>
      </details>
      {isCreating && (
        <CreateCompanyModal
          onClose={closeModal}
          onCreated={(id) => {
            closeModal();
            selectCompany(id);
          }}
        />
      )}
    </div>
  );
}

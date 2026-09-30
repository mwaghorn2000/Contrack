"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useId, useRef, useState } from "react";
import MemberAvatar from "./_home-components/member-avatar";

export default function AccountMenu({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string | null;
  image: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openedByHover = useRef(false);
  const panelId = useId();
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId");
  const companyQuery = companyId
    ? `?${new URLSearchParams({ companyId }).toString()}`
    : "";
  const displayName = name ?? email ?? "Account";

  useEffect(() => {
    if (!open) {
      openedByHover.current = false;
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");
    try {
      await signOut({ redirectTo: "/login" });
    } catch {
      setError("Could not log out. Please try again.");
      setLoggingOut(false);
    }
  }

  const linkClass =
    "block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-2 focus-visible:outline-gray-900";

  return (
    <div
      ref={containerRef}
      className="relative ml-auto min-w-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && !open) {
          openedByHover.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !event.currentTarget.contains(document.activeElement)
        ) {
          setOpen(false);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Account options for ${displayName}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // A click after hovering keeps the menu open; subsequent clicks toggle.
          const nextOpen = openedByHover.current || !open;
          openedByHover.current = false;
          setOpen(nextOpen);
        }}
        className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
      >
        <span className="hidden max-w-40 truncate text-sm md:block">
          {displayName}
        </span>
        <MemberAvatar name={displayName} image={image} />
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m5 7.5 5 5 5-5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        // Padding bridges the hover area between the button and dropdown.
        <div
          id={panelId}
          className="absolute top-full right-0 z-50 w-72 max-w-[calc(100vw-2rem)] pt-2"
        >
          <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            <div className="border-b border-gray-200 px-3 py-3">
              <p className="text-sm font-semibold break-words text-gray-900">
                {displayName}
              </p>
              {email && (
                <p className="mt-1 text-xs break-words text-gray-500">
                  {email}
                </p>
              )}
            </div>
            <nav aria-label="Account navigation" className="space-y-1 py-2">
              <Link
                href={`/dashboard/profile${companyQuery}`}
                onClick={() => setOpen(false)}
                className={linkClass}
              >
                My profile
              </Link>
              <Link
                href={`/dashboard/settings${companyQuery}`}
                onClick={() => setOpen(false)}
                className={linkClass}
              >
                Account settings
              </Link>
            </nav>
            <div className="border-t border-gray-200 pt-2">
              <button
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-60"
              >
                {loggingOut ? "Logging out…" : "Log out"}
              </button>
              {error && (
                <p role="alert" className="px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

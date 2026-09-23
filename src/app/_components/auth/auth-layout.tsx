"use client";

import { useState, type ReactNode } from "react";

import WorkspaceAnimation from "./workspace-animation";

export default function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [isAnimationPaused, setIsAnimationPaused] = useState(false);

  return (
    <main className="grid min-h-screen bg-gray-50 md:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12 sm:px-12 md:border-r md:border-gray-200 lg:px-16">
        <section className="w-full max-w-md">
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight">Contrack</h1>

            <h2 className="mt-3 text-xl font-semibold">{title}</h2>

            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </header>

          {children}
        </section>
      </div>

      <aside className="relative hidden min-w-0 flex-col items-center justify-center overflow-hidden bg-slate-100/60 px-5 py-20 md:flex lg:px-10">
        <div className="w-full max-w-xl">
          <WorkspaceAnimation paused={isAnimationPaused} />
        </div>

        <div className="mt-6 max-w-sm text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 lg:text-3xl">
            One place for every job.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-500 lg:text-base">
            Keep your people, projects, and progress connected.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAnimationPaused((paused) => !paused)}
          className="absolute right-6 bottom-6 inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-white/70 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:hidden"
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
          >
            {isAnimationPaused ? (
              <path d="M3 1.5 10 6l-7 4.5z" />
            ) : (
              <>
                <rect x="2.5" y="2" width="2" height="8" rx="0.5" />
                <rect x="7.5" y="2" width="2" height="8" rx="0.5" />
              </>
            )}
          </svg>
          {isAnimationPaused ? "Resume animation" : "Pause animation"}
        </button>
      </aside>
    </main>
  );
}

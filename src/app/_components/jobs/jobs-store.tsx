"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { JobTile } from "~/lib/job-tiles";

/** A job as the UI holds it until jobs are saved on the server. */
export type DraftJob = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  memberIds: string[];
  tiles: JobTile[];
};

export const MOCK_JOBS: DraftJob[] = [
  {
    id: "mock-roof",
    name: "Roof inspection",
    description: "Check flashing and gutters on the north side.\nBook a lift.",
    photoUrl: null,
    memberIds: [],
    tiles: [
      {
        id: "mock-roof-1",
        type: "text",
        visibility: { mode: "everyone" },
        config: { body: "Wear a harness at all times on the roof." },
      },
    ],
  },
  {
    id: "mock-fitout",
    name: "Kitchen fit-out",
    description: "Install cabinets and benchtops for unit 4.",
    photoUrl: null,
    memberIds: [],
    tiles: [],
  },
];

const JobsStoreContext = createContext<DraftJob[] | null>(null);

/**
 * Holds jobs in memory while the Jobs UI is built ahead of the backend.
 * Every company starts with `initialJobs`.
 */
export function JobsStoreProvider({
  initialJobs = MOCK_JOBS,
  children,
}: {
  initialJobs?: DraftJob[];
  children: ReactNode;
}) {
  return (
    <JobsStoreContext.Provider value={initialJobs}>
      {children}
    </JobsStoreContext.Provider>
  );
}

/** Returns the jobs from the nearest JobsStoreProvider. */
export function useCompanyJobs() {
  const jobs = useContext(JobsStoreContext);
  if (!jobs) throw new Error("useCompanyJobs needs a JobsStoreProvider");
  return jobs;
}

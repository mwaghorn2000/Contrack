"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { JobTile } from "./tiles/registry";

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

type JobsStore = {
  jobs: (companyId: string) => DraftJob[];
  saveJob: (companyId: string, job: DraftJob) => void;
};

const JobsStoreContext = createContext<JobsStore | null>(null);

/**
 * Holds jobs in memory, per company, while the Jobs UI is built ahead of the
 * backend. Companies without saved changes show `initialJobs`.
 */
export function JobsStoreProvider({
  initialJobs = MOCK_JOBS,
  children,
}: {
  initialJobs?: DraftJob[];
  children: ReactNode;
}) {
  const [jobsByCompany, setJobsByCompany] = useState<
    Record<string, DraftJob[]>
  >({});
  const store = useMemo<JobsStore>(
    () => ({
      jobs: (companyId) => jobsByCompany[companyId] ?? initialJobs,
      saveJob: (companyId, job) =>
        setJobsByCompany((current) => {
          const jobs = current[companyId] ?? initialJobs;
          return {
            ...current,
            [companyId]: jobs.some(({ id }) => id === job.id)
              ? jobs.map((saved) => (saved.id === job.id ? job : saved))
              : [...jobs, job],
          };
        }),
    }),
    [jobsByCompany, initialJobs],
  );
  return (
    <JobsStoreContext.Provider value={store}>
      {children}
    </JobsStoreContext.Provider>
  );
}

/** Returns the nearest JobsStoreProvider's store. */
function useJobsStore() {
  const store = useContext(JobsStoreContext);
  if (!store) throw new Error("Jobs hooks need a JobsStoreProvider");
  return store;
}

/** Returns the jobs for a company. */
export function useCompanyJobs(companyId: string) {
  return useJobsStore().jobs(companyId);
}

/** Returns one of a company's jobs, or undefined when there is no such job. */
export function useJob(companyId: string, jobId: string) {
  return useCompanyJobs(companyId).find((job) => job.id === jobId);
}

/** Returns a function that adds a job to a company, or replaces it by id. */
export function useSaveJob() {
  return useJobsStore().saveJob;
}

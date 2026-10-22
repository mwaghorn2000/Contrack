import type { ReactNode } from "react";
import { JobsStoreProvider } from "~/app/_components/jobs/jobs-store";

/** Shares the in-memory jobs store across the Jobs pages. */
export default function JobsLayout({ children }: { children: ReactNode }) {
  return <JobsStoreProvider>{children}</JobsStoreProvider>;
}

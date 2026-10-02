// Allow only known destinations, never an arbitrary redirect supplied by a client.
export function safeAuthDestination(value: string | null | undefined) {
  return value &&
    (value === "/dashboard" ||
      value === "/dashboard/profile" ||
      value === "/dashboard/settings" ||
      /^\/invite\/[a-f0-9]{64}$/.test(value))
    ? value
    : "/dashboard";
}

export function completionPath(destination: string) {
  return `/auth/complete?next=${encodeURIComponent(safeAuthDestination(destination))}`;
}

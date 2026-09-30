// Only allow our opaque token here, never an arbitrary return URL.
export function invitationToken(value: string | null | undefined) {
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export function invitationDestination(token?: string | null) {
  const valid = invitationToken(token);
  return valid ? `/invite/${valid}` : "/dashboard";
}

export function authPath(
  path: "/signup" | "/login" | "/verify-email",
  token?: string | null,
  email?: string | null,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams(extra);
  const valid = invitationToken(token);
  if (valid) params.set("invite", valid);
  if (email) params.set("email", email);
  return `${path}${params.size ? `?${params.toString()}` : ""}`;
}

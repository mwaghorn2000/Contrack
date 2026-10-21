export default function UnreadBadge({
  count,
  label,
}: {
  count: number;
  /** What is unread, for screen readers, e.g. "unread messages". */
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs leading-5 font-semibold text-white">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

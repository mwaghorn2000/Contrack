/**
 * Asks before deleting an answer, with Delete and Cancel. Focus starts on
 * Cancel, the safe choice; Delete does nothing while a change is saving.
 */
export default function ConfirmDelete({
  label,
  question,
  busy,
  onDelete,
  onCancel,
}: {
  label: string;
  question: string;
  busy: boolean;
  onDelete: () => Promise<unknown>;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2"
    >
      <span>{question}</span>
      <button
        type="button"
        aria-disabled={busy}
        onClick={() => void (busy || onDelete())}
        className="rounded-md bg-red-700 px-3 py-1 text-white aria-disabled:opacity-50"
      >
        Delete
      </button>
      <button
        type="button"
        autoFocus
        onClick={onCancel}
        className="rounded-md border border-gray-300 bg-white px-3 py-1"
      >
        Cancel
      </button>
    </div>
  );
}

import type { TileVisibility } from "~/lib/job-tiles";

/** Someone on the job, as tile settings list them. */
export type JobPerson = { id: string; name: string | null };

/** Sums up who can see a tile, for the chip in its header. */
export function visibilityLabel(visibility: TileVisibility) {
  if (visibility.mode === "everyone") return "Everyone";
  const count = visibility.userIds.length;
  if (count === 0) return "Admins only";
  return `${count} member${count === 1 ? "" : "s"}`;
}

/**
 * Chooses whether a tile is for everyone on the job or only some of them, and
 * whether the people who can see it are asked to acknowledge it.
 */
export default function TileSettings({
  tileId,
  visibility,
  requiresAcknowledgment,
  people,
  onChange,
  onAcknowledgmentChange,
}: {
  tileId: string;
  visibility: TileVisibility;
  requiresAcknowledgment: boolean;
  people: JobPerson[];
  onChange: (visibility: TileVisibility) => void;
  onAcknowledgmentChange: (requiresAcknowledgment: boolean) => void;
}) {
  const selected = visibility.mode === "members" ? visibility.userIds : [];
  return (
    <div className="space-y-2 border-b border-gray-100 bg-gray-50 px-3 py-3 text-sm">
      <fieldset className="space-y-2">
        <legend className="sr-only">Who can see this tile</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`visibility-${tileId}`}
            checked={visibility.mode === "everyone"}
            onChange={() => onChange({ mode: "everyone" })}
          />
          Everyone on the job
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`visibility-${tileId}`}
            checked={visibility.mode === "members"}
            onChange={() => onChange({ mode: "members", userIds: [] })}
          />
          Only selected members
        </label>
        {visibility.mode === "members" &&
          (people.length === 0 ? (
            <p className="pl-6 text-gray-500">Add people to the job first.</p>
          ) : (
            <ul
              role="group"
              aria-label="Members who can see this tile"
              className="space-y-1 pl-6"
            >
              {people.map((person) => (
                <li key={person.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(person.id)}
                      onChange={(event) =>
                        onChange({
                          mode: "members",
                          userIds: event.target.checked
                            ? [...selected, person.id]
                            : selected.filter((id) => id !== person.id),
                        })
                      }
                      className="size-4"
                    />
                    {person.name ?? "Unnamed member"}
                  </label>
                </li>
              ))}
            </ul>
          ))}
        <p className="text-xs text-gray-500">
          Company owners and admins can always see every tile.
        </p>
      </fieldset>
      {/* Outside the fieldset: it isn't one of the visibility choices. */}
      <label className="flex items-center gap-2 border-t border-gray-200 pt-2">
        <input
          type="checkbox"
          checked={requiresAcknowledgment}
          onChange={(event) => onAcknowledgmentChange(event.target.checked)}
          className="size-4"
        />
        Ask people who can see it to acknowledge it
      </label>
    </div>
  );
}

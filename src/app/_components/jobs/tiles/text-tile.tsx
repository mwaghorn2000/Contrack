type TextConfig = { body: string };

/** Lets the job's author write the text shown in a Text tile. */
export function TextTileEditor({
  config,
  onChange,
}: {
  config: TextConfig;
  onChange: (config: TextConfig) => void;
}) {
  return (
    <textarea
      aria-label="Text"
      rows={3}
      maxLength={5000}
      value={config.body}
      onChange={(event) => onChange({ body: event.target.value })}
      placeholder="Instructions or notes for the job…"
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900"
    />
  );
}

/** Shows a Text tile's text, keeping the author's line breaks. */
export function TextTileView({ config }: { config: TextConfig }) {
  return <p className="text-sm whitespace-pre-wrap">{config.body}</p>;
}

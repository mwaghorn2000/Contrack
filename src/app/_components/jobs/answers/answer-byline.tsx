import type { TileAnswer } from "../tiles/define-tile";

/** Who gave an answer and when, noting when it has been changed since. */
export default function AnswerByline({
  answer,
}: {
  answer: Pick<TileAnswer<unknown>, "author" | "createdAt" | "updatedAt">;
}) {
  const edited = answer.updatedAt.getTime() - answer.createdAt.getTime() > 1000;
  return (
    <span className="text-xs text-gray-500">
      {answer.author?.name ?? "A former member"} ·{" "}
      {answer.createdAt.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      })}
      {edited && " · edited"}
    </span>
  );
}

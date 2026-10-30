"use client";

import type { ComponentType } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import type { AnswersProps } from "../tiles/define-tile";

type Answer = RouterOutputs["jobTile"]["listAnswers"][string][number];

/**
 * Hands a tile's answers (loaded once for the whole job by the job page) to
 * the tile type's answers component, with save and delete actions, and shows
 * an alert when one fails.
 */
export default function TileAnswers<Config>({
  jobId,
  tileId,
  config,
  answers,
  viewer,
  readOnly,
  Answers,
}: {
  jobId: string;
  tileId: string;
  config: Config;
  answers: Answer[];
  viewer: { userId: string; isManager: boolean };
  readOnly: boolean;
  Answers: ComponentType<AnswersProps<Config, unknown>>;
}) {
  const utils = api.useUtils();
  const onSuccess = () => utils.jobTile.listAnswers.invalidate({ jobId });
  const create = api.jobTile.createAnswer.useMutation({ onSuccess });
  const update = api.jobTile.updateAnswer.useMutation({ onSuccess });
  const remove = api.jobTile.deleteAnswer.useMutation({ onSuccess });
  // The latest failure, shown below the tile; a new attempt clears it.
  const error = create.error ?? update.error ?? remove.error;
  /** Runs a change after clearing the last failure; resolves to whether it saved. */
  const run = (change: () => Promise<unknown>) => {
    [create, update, remove].forEach((each) => each.reset());
    return change().then(
      () => true,
      () => false,
    );
  };

  return (
    <>
      <Answers
        config={config}
        answers={answers}
        viewer={viewer}
        readOnly={readOnly}
        busy={create.isPending || update.isPending || remove.isPending}
        onCreate={(data, note) =>
          run(() => create.mutateAsync({ tileId, data, note }))
        }
        onUpdate={(answerId, data, note) =>
          run(() => update.mutateAsync({ answerId, data, note }))
        }
        onDelete={(answerId) => run(() => remove.mutateAsync({ answerId }))}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </>
  );
}

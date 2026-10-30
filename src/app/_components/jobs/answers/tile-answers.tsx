"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import type { AnswersProps } from "../tiles/define-tile";

type Answer = RouterOutputs["jobTile"]["listAnswers"][string][number];

/**
 * Hands a tile's answers (loaded once for the whole job by the job page) to
 * the tile type's answers component, with save and delete actions, and shows
 * an alert when one fails. Changes show straight away and are undone if the
 * save fails, so ticking a box doesn't wait for the server.
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
  const queryClient = useQueryClient();
  const key = { jobId };
  /** Changes this tile's cached answers now, before the server replies. */
  const change = async (edit: (answers: Answer[]) => Answer[]) => {
    await utils.jobTile.listAnswers.cancel(key);
    utils.jobTile.listAnswers.setData(
      key,
      (all) => all && { ...all, [tileId]: edit(all[tileId] ?? []) },
    );
  };
  // Reloaded once the last answer change settles, so one save's reload can't
  // hide another still on its way. Not awaited: a change is done once saved.
  const onSettled = () => {
    if (queryClient.isMutating({ mutationKey: [["jobTile"]] }) <= 1)
      void utils.jobTile.listAnswers.invalidate(key);
  };
  const create = api.jobTile.createAnswer.useMutation({
    onMutate: async ({ data, note }) => {
      // Stands in for the answer until the server gives its id.
      const standIn = `saving-${crypto.randomUUID()}`;
      await change((answers) => [
        ...answers,
        {
          id: standIn,
          author: { id: viewer.userId, name: "You", image: null },
          data,
          note: note?.trim() ? note.trim() : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          canEdit: false,
          canDelete: true,
        },
      ]);
      return { standIn };
    },
    // The saved id replaces the stand-in's, so it can be changed right away.
    onSuccess: ({ id }, _input, context) =>
      change((answers) =>
        answers.map((answer) =>
          answer.id === context.standIn
            ? { ...answer, id, canEdit: true }
            : answer,
        ),
      ),
    // Undoes only this change, leaving others still on their way.
    onError: (_error, _input, context) =>
      context &&
      change((answers) =>
        answers.filter((answer) => answer.id !== context.standIn),
      ),
    onSettled,
  });
  const update = api.jobTile.updateAnswer.useMutation({
    onMutate: async ({ answerId, data, note }) => {
      const before = utils.jobTile.listAnswers
        .getData(key)
        ?.[tileId]?.find((answer) => answer.id === answerId);
      await change((answers) =>
        answers.map((answer) =>
          answer.id === answerId
            ? {
                ...answer,
                data,
                // Leaving the note out keeps it, as on the server.
                note: note === undefined ? answer.note : note.trim() || null,
                updatedAt: new Date(),
              }
            : answer,
        ),
      );
      return { before };
    },
    onError: (_error, { answerId }, context) =>
      context?.before &&
      change((answers) =>
        answers.map((answer) =>
          answer.id === answerId && context.before ? context.before : answer,
        ),
      ),
    onSettled,
  });
  const remove = api.jobTile.deleteAnswer.useMutation({
    onMutate: async ({ answerId }) => {
      const answers = utils.jobTile.listAnswers.getData(key)?.[tileId] ?? [];
      const index = answers.findIndex((answer) => answer.id === answerId);
      await change((current) =>
        current.filter((answer) => answer.id !== answerId),
      );
      return { removed: answers[index], index };
    },
    // Puts the answer back where it was.
    onError: (_error, _input, context) =>
      context?.removed &&
      change((answers) => [
        ...answers.slice(0, context.index),
        context.removed!,
        ...answers.slice(context.index),
      ]),
    onSettled,
  });
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

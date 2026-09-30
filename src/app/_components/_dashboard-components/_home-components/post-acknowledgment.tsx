"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import AcknowledgmentDashboard from "./acknowledgment-dashboard";

export default function PostAcknowledgment({
  companyId,
  postId,
  title,
  acknowledged,
  count,
  canManage,
}: {
  companyId: string;
  postId: string;
  title: string;
  acknowledged: boolean;
  count: number;
  canManage: boolean;
}) {
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const utils = api.useUtils();
  const mutation = api.company.setPostAcknowledgment.useMutation({
    onMutate: async () => {
      await utils.company.getCompanyPosts.cancel({ companyId });
    },
    onSuccess: async (result) => {
      await utils.company.getCompanyPosts.cancel({ companyId });
      utils.company.getCompanyPosts.setData({ companyId }, (posts) =>
        posts?.map((post) =>
          post.id === postId ? { ...post, ...result } : post,
        ),
      );
      void utils.company.getPostAcknowledgments.invalidate({
        companyId,
        postId,
      });
    },
  });
  const isAcknowledged = mutation.isPending
    ? mutation.variables.acknowledged
    : acknowledged;
  const displayedCount = Math.max(
    0,
    count + Number(isAcknowledged) - Number(acknowledged),
  );

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={isAcknowledged}
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate({ companyId, postId, acknowledged: !acknowledged })
          }
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-wait ${isAcknowledged ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="size-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m5 12 4 4L19 6"
            />
          </svg>
          {isAcknowledged ? "Acknowledged" : "Acknowledge"}
          <span className="tabular-nums">{displayedCount}</span>
        </button>
        {canManage && (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setDashboardOpen(true)}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
          >
            View acknowledgments
          </button>
        )}
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          Could not update your acknowledgment. Please try again.
        </p>
      )}
      {dashboardOpen && canManage && (
        <AcknowledgmentDashboard
          companyId={companyId}
          postId={postId}
          title={title}
          onClose={() => setDashboardOpen(false)}
        />
      )}
    </div>
  );
}

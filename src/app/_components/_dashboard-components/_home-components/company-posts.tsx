"use client";

import { api, type RouterOutputs } from "~/trpc/react";
import CreatePost from "./company-createpost";
import CompanyPost from "./company-post";
import PostAcknowledgment from "./post-acknowledgment";

type CompanyPostsProps = {
  companyId: string;
  initialPosts: RouterOutputs["company"]["getCompanyPosts"];
  canManage: boolean;
  viewer: { name: string | null; image: string | null };
};

export default function CompanyPosts({
  companyId,
  initialPosts,
  canManage,
  viewer,
}: CompanyPostsProps) {
  const utils = api.useUtils();
  const input = { companyId };
  const posts = api.company.getCompanyPosts.useQuery(input, {
    initialData: initialPosts,
  });
  const createPost = api.company.createCompanyPost.useMutation({
    onMutate: async () => {
      await utils.company.getCompanyPosts.cancel(input);
    },
    onSuccess: async ({ post }) => {
      await utils.company.getCompanyPosts.cancel(input);
      utils.company.getCompanyPosts.setData(input, (current) => [
        post,
        ...(current ?? []).filter((existing) => existing.id !== post.id),
      ]);
    },
  });
  const deletePost = api.company.deleteCompanyPost.useMutation({
    onSuccess: async (_, variables) => {
      await utils.company.getCompanyPosts.cancel(input);
      utils.company.getCompanyPosts.setData(input, (current) =>
        current?.filter((post) => post.id !== variables.postId),
      );
    },
  });

  // Keep the pending post separate from fetched data so refetches cannot erase it.
  // On failure it disappears automatically, while the composer retains the draft.
  const pendingPost = createPost.isPending ? createPost.variables : undefined;

  return (
    <section aria-label="Company posts" className="space-y-4">
      <CreatePost
        canBeSeen={canManage}
        isSubmitting={createPost.isPending}
        onCreate={async (values) => {
          await createPost.mutateAsync({ ...values, companyId });
        }}
      />

      {posts.isError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <p>Could not refresh company posts.</p>
          <button
            type="button"
            onClick={() => void posts.refetch()}
            disabled={posts.isFetching}
            className="mt-2 rounded font-medium underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {posts.isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}

      {deletePost.isError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          Could not delete the post. Please try again.
        </p>
      )}

      {pendingPost && (
        <div className="space-y-2">
          <CompanyPost
            id="pending-post"
            title={pendingPost.title}
            content={pendingPost.content}
            canDelete={false}
            isDeleting={false}
            onDelete={() => undefined}
            author={viewer}
          />
          <p role="status" className="px-4 text-sm text-gray-500 sm:px-6">
            Publishing…
          </p>
        </div>
      )}

      {posts.data.map((post) => (
        <CompanyPost
          key={post.id}
          id={post.id}
          title={post.title}
          content={post.content}
          author={post.author}
          createdAt={post.createdAt}
          canDelete={canManage}
          isDeleting={
            deletePost.isPending && deletePost.variables?.postId === post.id
          }
          onDelete={(postId) => {
            if (!deletePost.isPending) deletePost.mutate({ postId, companyId });
          }}
        >
          <PostAcknowledgment
            companyId={companyId}
            postId={post.id}
            title={post.title}
            acknowledged={post.acknowledged}
            count={post.acknowledgmentCount}
            canManage={canManage}
          />
        </CompanyPost>
      ))}

      {posts.data.length === 0 && !pendingPost && (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          No company updates yet.
        </p>
      )}
    </section>
  );
}

import { type ReactNode } from "react";
import MemberAvatar from "./member-avatar";

type CompanyPostProps = {
  id: string;
  title: string;
  content: string;
  canDelete: boolean;
  isDeleting: boolean;
  onDelete: (id: string) => void;
  author: { name: string | null; image: string | null } | null;
  createdAt?: Date;
  children?: ReactNode;
};

export default function CompanyPost({
  id,
  title,
  content,
  canDelete,
  isDeleting,
  onDelete,
  author,
  createdAt,
  children,
}: CompanyPostProps) {
  const authorName =
    author?.name ?? (author ? "Company member" : "Former member");
  return (
    <article className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <MemberAvatar name={authorName} image={author?.image ?? null} />
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-gray-900">
            {authorName}
          </p>
          {createdAt && (
            <time
              dateTime={createdAt.toISOString()}
              className="text-xs text-gray-500"
            >
              {createdAt.toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </time>
          )}
        </div>
      </div>
      <h2 className="text-lg font-semibold tracking-tight break-words text-gray-900">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 break-words whitespace-pre-wrap text-gray-600">
        {content}
      </p>

      {(children != null || canDelete) && (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-gray-200 pt-4">
          {children}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(id)}
              disabled={isDeleting}
              aria-label={`Delete post: ${title}`}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

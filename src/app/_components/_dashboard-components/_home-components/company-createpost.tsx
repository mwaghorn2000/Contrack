"use client";

import { useId, useState } from "react";

type CreatePostFormProps = {
  onCreate: (values: { title: string; content: string }) => Promise<void>;
  isSubmitting: boolean;
  canBeSeen: boolean;
};

export default function CreatePost({
  onCreate,
  isSubmitting,
  canBeSeen,
}: CreatePostFormProps) {
  const formId = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState("");

  if (!canBeSeen) return null;

  return (
    <section
      className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm sm:p-6"
      aria-label="Create a company post"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            Company updates
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            Share news and updates with your company.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((previous) => !previous)}
          aria-expanded={formOpen}
          aria-controls={formOpen ? formId : undefined}
          disabled={isSubmitting}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formOpen ? "Cancel" : "Create post"}
        </button>
      </div>
      {formOpen && (
        <form
          id={formId}
          className="mt-5 space-y-4 border-t border-gray-200 pt-5"
          aria-busy={isSubmitting}
          onSubmit={async (event) => {
            event.preventDefault();

            if (isSubmitting) return;

            setError("");

            if (!title.trim() || !content.trim()) {
              setError("Enter a title and content for your post.");
              return;
            }

            try {
              await onCreate({ title: title.trim(), content: content.trim() });
              setTitle("");
              setContent("");
              setFormOpen(false);
            } catch {
              setError("Could not create the post. Please try again.");
            }
          }}
        >
          <div>
            <label
              htmlFor={`${formId}-title`}
              className="block text-sm font-medium text-gray-900"
            >
              Title
            </label>
            <input
              id={`${formId}-title`}
              name="title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={100}
              disabled={isSubmitting}
              placeholder="Give your update a title"
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-content`}
              className="block text-sm font-medium text-gray-900"
            >
              Content
            </label>
            <textarea
              id={`${formId}-content`}
              name="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required
              maxLength={1000}
              rows={5}
              disabled={isSubmitting}
              placeholder="What would you like to share?"
              className="mt-1 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus-visible:outline-2 focus-visible:outline-gray-900 disabled:bg-gray-50"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Publishing…" : "Publish post"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

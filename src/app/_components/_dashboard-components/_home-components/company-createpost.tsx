import { useState } from "react";

type CreatePostFormProps = {
  onCreate: (values: { title: string; content: string }) => Promise<void>;
  isSubmitting: false;
  canBeSeen: boolean;
};

export default function CreatePost({
  onCreate,
  isSubmitting,
}: CreatePostFormProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState("");

  return (
    <div>
        {formOpen && (
            <form
                onSubmit={async (event) => {
                    event.preventDefault();

                    if (isSubmitting) return;

                    setError("");

                    try {
                        await onCreate({ title, content });
                        setTitle("");
                        setContent("");
                        setFormOpen(false);
                    } catch {
                        setError("Could not create the post. Please try again.");
                    }
                }}
            >
                <label htmlFor="post-title">
                    Title
                </label>
                <input
                    id="post-title"
                    name="title"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                />
                <label htmlFor="post-content">Content</label>
                <textarea 
                    id="post-content"
                    name="content"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    required
                />

                {error && <p role="alert">{error}</p>}
                
                <button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "submitting..." : "Submit"}
                </button>
            </form>
        )}

        <button 
            type="button"
            onClick={() => setFormOpen((previous) => !previous)}
            aria-expanded={formOpen}
        >
            {formOpen ? "-" : "+"}
        </button>
    </div>
  );
}

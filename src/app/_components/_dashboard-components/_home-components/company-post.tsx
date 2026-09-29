
type CompanyPostProps = {
    id: string;
    title: string;
    content: string;
    canDelete: boolean;
    isDeleting: boolean;
    onDelete: (id: string) => void;
}


export default function CompanyPost({
    id,
    title,
    content,
    canDelete,
    isDeleting,
    onDelete,
}: CompanyPostProps) {
    return (
      <article>
        <h2>{title}</h2>
        <p>{content}</p>

        {canDelete && (
            <button 
                onClick={() => onDelete(id)}
                disabled={isDeleting}
            >
                {isDeleting ? "Deleting..." : "Delete"}
            </button>
        )}
      </article>
    );
}
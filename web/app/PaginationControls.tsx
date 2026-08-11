'use client';

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
};

export default function PaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange
}: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  if (pageCount <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="button-secondary"
        type="button"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>Page {page + 1} of {pageCount}</span>
      <button
        className="button-secondary"
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

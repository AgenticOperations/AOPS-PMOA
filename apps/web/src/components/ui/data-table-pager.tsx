'use client';

import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

type DataTablePagerProps = {
  readonly itemLabel: string;
  readonly onPageChange: (page: number) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
};

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 1, totalPages - 2));
  return Array.from({ length: Math.min(3, totalPages) }, (_, index) => start + index);
}

export function DataTablePager({ itemLabel, onPageChange, page, pageSize, total }: DataTablePagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  return (
    <nav aria-label={`${itemLabel} pagination`} className="data-table-pager">
      <span>Showing {start}-{end} of {total}</span>
      <div className="data-table-page-controls">
        <button
          aria-label={`Previous ${itemLabel} page`}
          disabled={safePage === 1}
          onClick={() => onPageChange(safePage - 1)}
          type="button"
        >
          <IconChevronLeft aria-hidden="true" size={14} stroke={1.8} />
        </button>
        {pageNumbers(safePage, totalPages).map((pageNumber) => (
          <button
            aria-current={pageNumber === safePage ? 'page' : undefined}
            className={pageNumber === safePage ? 'is-current' : undefined}
            key={pageNumber}
            onClick={() => onPageChange(pageNumber)}
            type="button"
          >
            {pageNumber}
          </button>
        ))}
        <button
          aria-label={`Next ${itemLabel} page`}
          disabled={safePage === totalPages}
          onClick={() => onPageChange(safePage + 1)}
          type="button"
        >
          <IconChevronRight aria-hidden="true" size={14} stroke={1.8} />
        </button>
      </div>
      <span>{pageSize} per page</span>
    </nav>
  );
}

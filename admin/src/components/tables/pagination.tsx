import Link from 'next/link';

export function Pagination({
  page,
  pageSize,
  total,
  searchParams,
}: Readonly<{
  page: number;
  pageSize: number;
  total: number;
  searchParams: Readonly<Record<string, string | string[] | undefined>>;
}>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string' && key !== 'page') query.set(key, value);
    }
    query.set('page', String(nextPage));
    return `?${query.toString()}`;
  };

  return (
    <nav aria-label="Sayfalama" className="pagination">
      {page > 1 ? <Link href={href(page - 1)}>Önceki</Link> : <span>Önceki</span>}
      <span aria-live="polite">Sayfa {page} / {pages}</span>
      {page < pages ? <Link href={href(page + 1)}>Sonraki</Link> : <span>Sonraki</span>}
    </nav>
  );
}

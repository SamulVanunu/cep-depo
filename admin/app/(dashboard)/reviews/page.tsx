import type { Metadata } from 'next';

import { Pagination } from '../../../src/components/tables/pagination';
import { listReviews } from '../../../src/features/reviews/review-dal';
import { ReviewList } from '../../../src/features/reviews/review-list';
import type { RawSearchParams } from '../../../src/lib/search-params';

export const metadata: Metadata = { title: 'Yorumlar' };

export default async function ReviewsPage({ searchParams }: Readonly<{ searchParams: Promise<RawSearchParams> }>) {
  const raw = await searchParams;
  const page = Math.max(1, Number(typeof raw.page === 'string' ? raw.page : 1) || 1);
  const status = raw.status === 'visible' || raw.status === 'hidden' ? raw.status : undefined;
  const rating = typeof raw.rating === 'string' ? Number(raw.rating) : undefined;
  const query = typeof raw.query === 'string' ? raw.query.trim() : undefined;
  const result = await listReviews({ page, pageSize: 25, status, rating, query });
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Topluluk</p><h1>Yorumlar</h1><p className="muted">Görünür ve gizli yorumları denetle.</p></div></header>
      <form className="filter-bar" method="get">
        <label className="field"><span>Ara</span><input defaultValue={query} maxLength={200} name="query" /></label>
        <label className="field"><span>Durum</span><select defaultValue={status ?? ''} name="status"><option value="">Tümü</option><option value="visible">Görünür</option><option value="hidden">Gizli</option></select></label>
        <label className="field"><span>Puan</span><select defaultValue={rating ?? ''} name="rating"><option value="">Tümü</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button className="secondary-button" type="submit">Filtrele</button>
      </form>
      <ReviewList reviews={result.items} />
      <Pagination page={result.page} pageSize={result.pageSize} searchParams={raw} total={result.count} />
    </>
  );
}

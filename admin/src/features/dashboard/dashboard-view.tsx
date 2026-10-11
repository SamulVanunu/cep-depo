import Link from 'next/link';

import { StatusBadge } from '../../components/status/status-badge';
import type { DashboardSummary } from './dashboard-dal';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function DashboardView({ summary }: Readonly<{ summary: DashboardSummary }>) {
  const counters = [
    { label: 'açık şikâyet', value: summary.openReportCount, href: '/reports?status=open', tone: 'danger' as const },
    { label: 'gizli yorum', value: summary.hiddenReviewCount, href: '/reviews?status=hidden', tone: 'warning' as const },
    { label: 'askıya alınmış kullanıcı', value: summary.suspendedUserCount, href: '/users?status=suspended', tone: 'warning' as const },
    { label: 'sürüm taslağı', value: summary.draftVersionCount, href: '/apps?versionStatus=draft', tone: 'neutral' as const },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operasyon merkezi</p>
          <h1>Özet</h1>
          <p className="muted">Yayın, moderasyon ve kullanıcı kuyruklarının güncel durumu.</p>
        </div>
        <StatusBadge tone="success">Sistem çevrimiçi</StatusBadge>
      </header>

      <section aria-labelledby="queues-heading">
        <div className="section-heading">
          <h2 id="queues-heading">İş kuyrukları</h2>
        </div>
        <div className="metric-grid">
          {counters.map(counter => (
            <Link
              aria-label={`${counter.value} ${counter.label}`}
              className="metric-card"
              href={counter.href}
              key={counter.href}
            >
              <StatusBadge tone={counter.tone}>İncele</StatusBadge>
              <strong>{counter.value}</strong>
              <span>{counter.label}</span>
              <span aria-hidden="true" className="metric-arrow">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="priority-heading" className="priority-section">
        <div className="section-heading">
          <div>
            <h2 id="priority-heading">Öncelikli işler</h2>
            <p className="muted">En eski açık kayıtlar önce gösterilir.</p>
          </div>
          <Link href="/reports?status=open">Tümünü gör</Link>
        </div>

        {summary.priorities.length ? (
          <ul className="priority-list">
            {summary.priorities.map(priority => (
              <li key={priority.id}>
                <Link href={priority.href}>
                  <span>
                    <strong>{priority.title}</strong>
                    <small>{priority.detail}</small>
                  </span>
                  <time dateTime={priority.createdAt}>{dateFormatter.format(new Date(priority.createdAt))}</time>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <h3>Bekleyen öncelikli iş yok</h3>
            <p className="muted">Yeni kayıtlar burada görünecek.</p>
          </div>
        )}
      </section>
    </>
  );
}

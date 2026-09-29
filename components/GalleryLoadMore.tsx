import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

export default function GalleryLoadMore({ hasMore, loading, error, count, total, loadMore }: {
  hasMore: boolean; loading: boolean; error: string | null; count: number; total: number; loadMore: () => Promise<void>;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading || error || !sentinel.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '800px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, loadMore]);
  return <div ref={sentinel} className="flex min-h-24 items-center justify-center gap-3 text-sm text-gray-500">
    <span>{count.toLocaleString()} / {total.toLocaleString()} 张</span>
    {loading ? <Loader2 size={18} className="animate-spin text-gold" /> : hasMore &&
      <button onClick={() => void loadMore()} className="rounded border border-white/10 px-4 py-2 text-gold hover:bg-white/5">{error ? '重试加载' : '加载更多'}</button>}
  </div>;
}

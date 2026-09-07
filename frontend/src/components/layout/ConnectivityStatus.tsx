import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';

export function ConnectivityStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return <span className="sr-only" role="status" aria-live="polite">Online</span>;
  return <div role="status" aria-live="assertive" className="fixed left-1/2 top-[calc(.75rem+env(safe-area-inset-top))] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-xl"><CloudOff className="h-4 w-4" />Offline · drafts stay here</div>;
}

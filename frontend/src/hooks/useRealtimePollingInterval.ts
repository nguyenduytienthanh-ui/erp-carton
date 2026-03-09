import { useEffect, useMemo, useState } from 'react';

type UseRealtimePollingIntervalOptions = {
  enabled: boolean;
  activeMs: number;
  hiddenMs?: number | false;
};

function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function useRealtimePollingInterval(
  options: UseRealtimePollingIntervalOptions
): number | false {
  const { enabled, activeMs, hiddenMs = false } = options;
  const [visible, setVisible] = useState<boolean>(isDocumentVisible());
  const [online, setOnline] = useState<boolean>(isBrowserOnline());

  useEffect(() => {
    const onVisibilityChange = () => setVisible(isDocumentVisible());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return useMemo(() => {
    if (!enabled || !online) return false;
    if (visible) return activeMs;
    return hiddenMs;
  }, [activeMs, enabled, hiddenMs, online, visible]);
}

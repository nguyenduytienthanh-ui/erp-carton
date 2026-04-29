import { Grid } from 'antd';
import { useMemo } from 'react';

import { useDesktopShellScrollRef } from '../components/Layout/DesktopShellScrollContext';

type DesktopTableStickyConfig = {
  offsetHeader: number;
  getContainer?: () => HTMLElement | Window;
};

export function useDesktopTableSticky(offsetHeader = 0): DesktopTableStickyConfig | undefined {
  const screens = Grid.useBreakpoint();
  const desktopShellScrollRef = useDesktopShellScrollRef();

  return useMemo(() => {
    if (!screens.lg) {
      return undefined;
    }
    return {
      offsetHeader,
      getContainer: () => desktopShellScrollRef?.current ?? window,
    };
  }, [desktopShellScrollRef, offsetHeader, screens.lg]);
}

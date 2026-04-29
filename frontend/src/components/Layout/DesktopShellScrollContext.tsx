import { createContext, useContext } from 'react';
import type { MutableRefObject } from 'react';

type DesktopShellScrollRef = MutableRefObject<HTMLDivElement | null>;

export const DesktopShellScrollContext = createContext<DesktopShellScrollRef | null>(null);

export function useDesktopShellScrollRef(): DesktopShellScrollRef | null {
  return useContext(DesktopShellScrollContext);
}

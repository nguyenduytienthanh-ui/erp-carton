import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

type FeatureRouteProps = {
  allow: boolean;
  fallbackTo?: string;
  children: ReactNode;
};

export default function FeatureRoute({
  allow,
  fallbackTo = '/',
  children,
}: FeatureRouteProps) {
  if (!allow) {
    return <Navigate to={fallbackTo} replace />;
  }
  return <>{children}</>;
}

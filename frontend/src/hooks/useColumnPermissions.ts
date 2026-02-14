/**
 * Hook kiểm tra quyền xem cột
 * User chỉ thấy cột được phép (không rối mắt)
 */
import { useQuery } from '@tanstack/react-query';
import { permissionsApi } from '../api/permissions';

export const useColumnPermissions = (page: string) => {
  const { data, isLoading } = useQuery({
    queryKey: ['column-permissions', page],
    queryFn: () => permissionsApi.getAvailableColumns(page),
    staleTime: 10 * 60 * 1000, // Cache 10 phút
  });

  /**
   * Kiểm tra user có quyền xem cột này không
   */
  const canViewColumn = (columnKey: string): boolean => {
    if (!data) return true; // Chưa load → Cho phép tạm

    if (!data.restricted_columns?.includes(columnKey)) {
      return true;
    }

    return data.available_columns?.includes(columnKey) ?? false;
  };

  return {
    availableColumns: data?.available_columns ?? [],
    restrictedColumns: data?.restricted_columns ?? [],
    canViewColumn,
    isLoading,
    userRoles: data?.user_roles ?? [],
  };
};

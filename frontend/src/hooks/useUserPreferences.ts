/**
 * GENERIC HOOK - DÙNG CHUNG CHO TẤT CẢ COMPONENT/PAGE
 *
 * Backend: UserPreferences model (1 model duy nhất)
 *
 * @param page - Identifier bất kỳ: 'products-list', 'dashboard', 'settings'...
 *
 * @example ProductList
 * const { config, saveConfig } = useUserPreferences('products-list');
 *
 * @example ProductForm
 * const { config, saveConfig } = useUserPreferences('products-form');
 *
 * @example Dashboard
 * const { config, saveConfig } = useUserPreferences('dashboard');
 *
 * KHI TẠO COMPONENT MỚI: Dùng hook này, KHÔNG tạo hook riêng!
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../api/preferences';
import type { PreferencesConfig } from '../types/preferences';

export const useUserPreferences = (page: string) => {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['preferences', page],
    queryFn: () => preferencesApi.getConfig(page),
    staleTime: 5 * 60 * 1000, // Cache 5 phút
  });

  const saveMutation = useMutation({
    mutationFn: (newConfig: PreferencesConfig) =>
      preferencesApi.saveConfig(page, newConfig),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences', page] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => preferencesApi.deleteConfig(page),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences', page] });
    },
  });

  return {
    config: config ?? {},
    isLoading,
    saveConfig: saveMutation.mutateAsync,
    deleteConfig: deleteMutation.mutateAsync,
  };
};

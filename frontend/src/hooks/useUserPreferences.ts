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
import { useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../api/preferences';
import type { PreferencesConfig } from '../types/preferences';

const EMPTY_CONFIG: PreferencesConfig = {};

export const useUserPreferences = (page: string) => {
  const queryClient = useQueryClient();
  const configCacheRef = useRef<PreferencesConfig>(EMPTY_CONFIG);

  const { data: rawConfig, isLoading } = useQuery({
    queryKey: ['preferences', page],
    queryFn: () => preferencesApi.getConfig(page),
    staleTime: 5 * 60 * 1000,
  });

  const config = useMemo(() => {
    if (rawConfig && Object.keys(rawConfig).length > 0) {
      configCacheRef.current = rawConfig;
      return rawConfig;
    }
    return configCacheRef.current;
  }, [rawConfig]);

  const saveMutation = useMutation({
    mutationFn: (newConfig: PreferencesConfig) =>
      preferencesApi.saveConfig(page, newConfig),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(['preferences', page], variables);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => preferencesApi.deleteConfig(page),
    onSuccess: () => {
      queryClient.setQueryData(['preferences', page], EMPTY_CONFIG);
    },
  });

  const saveConfig = useCallback(
    (newConfig: PreferencesConfig) => saveMutation.mutateAsync(newConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page]
  );

  const deleteConfig = useCallback(
    () => deleteMutation.mutateAsync(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page]
  );

  return {
    config,
    isLoading,
    saveConfig,
    deleteConfig,
  };
};

/**
 * Shared: Gọi API xoá 1 dòng / nhiều dòng + toast + refetch + clear selection.
 * Dùng chung cho Product, Category, Unit, ...
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { TOAST } from '../shared/toast';
import { getToastMessage } from '../shared/apiError';

interface UseBulkDeleteOptions {
  /** Query key để invalidate sau khi xoá (ví dụ: ['products']) */
  queryKey: string[];
  /** Gọi API xoá từng id (hoặc bulk API nếu có) */
  deleteFn: (id: number) => Promise<void>;
  /** Callback clear selection sau khi xoá thành công */
  onClearSelection: () => void;
  /** Callback remove id khỏi selection (dùng khi xoá 1 dòng) */
  onRemoveFromSelection?: (id: number) => void;
}

export function useBulkDelete({
  queryKey,
  deleteFn,
  onClearSelection,
  onRemoveFromSelection,
}: UseBulkDeleteOptions) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const deleteOneMutation = useMutation({
    mutationFn: (id: number) => deleteFn(id),
    onSuccess: (_, id) => {
      message.success(TOAST.DELETE_SUCCESS);
      queryClient.invalidateQueries({ queryKey });
      onRemoveFromSelection?.(id) ?? onClearSelection();
    },
    onError: (err) => {
      message.error(getToastMessage(err));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => deleteFn(id)));
    },
    onSuccess: (_, ids) => {
      message.success(TOAST.DELETE_BULK_SUCCESS(ids.length));
      queryClient.invalidateQueries({ queryKey });
      onClearSelection();
    },
    onError: (err) => {
      message.error(getToastMessage(err));
    },
  });

  return {
    deleteOneMutation,
    bulkDeleteMutation,
  };
}

import axiosInstance from './axios';

export interface AttachmentItem {
  id: number;
  entity_type: string;
  entity_id: number;
  file: string;
  file_url: string | null;
  filename: string;
  file_size: number;
  file_size_display: string;
  file_type: string;
  description: string;
  uploaded_by: number;
  uploaded_by_username: string;
  uploaded_at: string;
}

export const attachmentsApi = {
  list: async (entityType: string, entityId: number): Promise<AttachmentItem[]> => {
    const response = await axiosInstance.get('/attachments/', {
      params: { entity_type: entityType, entity_id: entityId, page_size: 100 },
    });
    const data = response.data;
    return (Array.isArray(data) ? data : (data as { results: AttachmentItem[] }).results ?? []) as AttachmentItem[];
  },

  upload: async (entityType: string, entityId: number, file: File, description?: string): Promise<AttachmentItem> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', String(entityId));
    formData.append('filename', file.name);
    if (description) formData.append('description', description);
    const response = await axiosInstance.post<AttachmentItem>('/attachments/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await axiosInstance.delete(`/attachments/${id}/`);
  },
};

export function isImageFile(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(filename);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

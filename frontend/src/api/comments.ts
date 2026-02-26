import axiosInstance from './axios';

export interface CommentItem {
  id: number;
  entity_type: string;
  entity_id: number;
  content: string;
  mentions: string[];
  parent: number | null;
  created_by: number;
  created_by_username: string;
  created_by_name: string;
  replies_count: number;
  created_at: string;
  updated_at: string;
}

export interface CommentCreatePayload {
  entity_type: string;
  entity_id: number;
  content: string;
  parent?: number;
}

export const commentsApi = {
  list: async (entityType: string, entityId: number): Promise<CommentItem[]> => {
    const response = await axiosInstance.get('/comments/', {
      params: { entity_type: entityType, entity_id: entityId, page_size: 100 },
    });
    const data = response.data;
    return (Array.isArray(data) ? data : (data as { results: CommentItem[] }).results ?? []) as CommentItem[];
  },

  create: async (data: CommentCreatePayload): Promise<CommentItem> => {
    const response = await axiosInstance.post('/comments/', data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await axiosInstance.delete(`/comments/${id}/`);
  },
};

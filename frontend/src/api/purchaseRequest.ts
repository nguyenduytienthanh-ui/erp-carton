import { PaginatedResponse } from './base';

export const purchaseRequestApi = {
  getRequests: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const queryString = new URLSearchParams(
      Object.entries(params || {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    const url = `/api/purchasing/requests/${queryString ? `?${queryString}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getRequest: async (id: number): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  createRequest: async (data: any): Promise<any> => {
    const res = await fetch('/api/purchasing/requests/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  updateRequest: async (id: number, data: any): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  deleteRequest: async (id: number): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  submitRequest: async (id: number): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/submit_request/`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  approveRequest: async (id: number): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/approve_request/`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  rejectRequest: async (id: number, reason: string): Promise<any> => {
    const res = await fetch(`/api/purchasing/requests/${id}/reject_request/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

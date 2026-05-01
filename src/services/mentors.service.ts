/**
 * Frontend mentors service.
 */
import { apiClient } from '@/lib/api-client';
import { clientEnvVars } from '@/lib/env';
import type { Mentor, MentorInput, UploadedFile } from '@/types/mentor';

export const mentorsService = {
  async list(): Promise<{ items: Mentor[]; total: number }> {
    return apiClient.get<{ items: Mentor[]; total: number }>('/mentors');
  },

  async create(input: MentorInput): Promise<Mentor> {
    return apiClient.post<Mentor>('/mentors', input);
  },

  async update(id: string, input: Partial<MentorInput>): Promise<Mentor> {
    return apiClient.put<Mentor>(`/mentors/${encodeURIComponent(id)}`, input);
  },

  async remove(id: string): Promise<void> {
    return apiClient.delete<void>(`/mentors/${encodeURIComponent(id)}`);
  },

  /**
   * Upload an image. Uses native fetch + FormData (the typed apiClient is
   * JSON-only). Returns the public URL the admin can paste into the
   * mentor record.
   */
  async uploadImage(file: File): Promise<UploadedFile> {
    const fd = new FormData();
    fd.append('file', file);
    const url = `${clientEnvVars.NEXT_PUBLIC_API_URL.replace(/\/$/, '')}/mentors/upload`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore — handled below
    }
    if (!res.ok) {
      const errBody = data as { error?: { code?: string; message?: string } } | null;
      const code = errBody?.error?.code ?? 'UPLOAD_FAILED';
      const message = errBody?.error?.message ?? `Upload failed (${res.status})`;
      throw new Error(`${code}: ${message}`);
    }
    return data as UploadedFile;
  },
};

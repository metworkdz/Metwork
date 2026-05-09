/**
 * Client-facing Mentor DTO. Returned by `GET /api/mentors` and the
 * admin CRUD endpoints.
 */
export interface Mentor {
  id: string;
  fullName: string;
  position: string;
  imageUrl: string;
  bio: string | null;
  linkedinUrl: string | null;
  /** Contact email for consultation notifications. */
  email?: string | null;
  /** Per-session fee in DZD. 0 or absent = free. */
  consultationFee?: number;
  createdAt: string;
}

export interface MentorInput {
  fullName: string;
  position: string;
  imageUrl: string;
  bio?: string | null;
  linkedinUrl?: string | null;
  email?: string | null;
  consultationFee?: number;
}

export interface UploadedFile {
  url: string;
  filename: string;
  size: number;
}

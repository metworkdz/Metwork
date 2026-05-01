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
  createdAt: string;
}

export interface MentorInput {
  fullName: string;
  position: string;
  imageUrl: string;
  bio?: string | null;
  linkedinUrl?: string | null;
}

export interface UploadedFile {
  url: string;
  filename: string;
  size: number;
}

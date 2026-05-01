/**
 * Server → client DTO for mentors. The on-disk shape and the wire shape
 * happen to be identical today; this seam exists so they can drift later
 * (e.g. if we add internal fields like createdBy or status) without
 * breaking the API.
 */
import type { MentorRecord } from '@/server/db/store';
import type { Mentor } from '@/types/mentor';

export function toMentorDto(m: MentorRecord): Mentor {
  return {
    id: m.id,
    fullName: m.fullName,
    position: m.position,
    imageUrl: m.imageUrl,
    bio: m.bio,
    linkedinUrl: m.linkedinUrl,
    createdAt: m.createdAt,
  };
}

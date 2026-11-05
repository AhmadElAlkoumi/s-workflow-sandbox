// View model for the Team members screen, generated from the Figma frames.
// This is the contract between design and frontend: the page renders anything
// that matches these types. Frontend maps the real API response to it.

export type MemberBadge = 'active' | 'invited' | 'suspended';

export interface Member {
  id: string;
  name: string;
  email: string;
  badge: MemberBadge;
}

export type TeamMembersVm = { state: 'default'; members: Member[] };

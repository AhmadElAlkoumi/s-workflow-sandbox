// View model for the Team members screen.
// This is the contract between design and frontend: the page renders anything
// that matches these types. Frontend maps the real API response to it.

export type MemberStatus = 'active' | 'invited' | 'suspended';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  status: MemberStatus;
}

export interface TeamStats {
  active: number;
  pending: number;
  suspended: number;
}

export type TeamMembersVm =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; workspaceName: string; stats: TeamStats; members: TeamMember[] };

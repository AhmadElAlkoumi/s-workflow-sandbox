import { TeamMembersVm } from './team-members.models';

// Mock data for previews and stakeholder review. Frontend replaces this with real data.
export const TEAM_MEMBERS_READY: TeamMembersVm = {
  state: 'ready',
  workspaceName: 'Acme',
  stats: { active: 12, pending: 3, suspended: 1 },
  members: [
    { id: 'u1', name: 'Lina Haddad', email: 'lina@acme.io', status: 'active' },
    { id: 'u2', name: 'Omar Khalil', email: 'omar@acme.io', status: 'active' },
    { id: 'u3', name: 'Sara Nasser', email: 'sara@acme.io', status: 'invited' },
    { id: 'u4', name: 'Yousef Ali', email: 'yousef@acme.io', status: 'suspended' },
  ],
};

export const TEAM_MEMBERS_EMPTY: TeamMembersVm = {
  state: 'ready',
  workspaceName: 'Acme',
  stats: { active: 0, pending: 0, suspended: 0 },
  members: [],
};

export const TEAM_MEMBERS_LONG: TeamMembersVm = {
  state: 'ready',
  workspaceName: 'Acme Holdings International Regional Operations',
  stats: { active: 1240, pending: 87, suspended: 12 },
  members: [
    { id: 'u5', name: 'Mohammad Abdulrahman Al-Khatib Al-Hashemi', email: 'mohammad.abdulrahman.alkhatib@acme-holdings-international.io', status: 'active' },
    ...(TEAM_MEMBERS_READY.state === 'ready' ? TEAM_MEMBERS_READY.members : []),
  ],
};

export const TEAM_MEMBERS_LOADING: TeamMembersVm = { state: 'loading' };

export const TEAM_MEMBERS_ERROR: TeamMembersVm = {
  state: 'error',
  message: "We couldn't load your team. Check your connection and try again.",
};

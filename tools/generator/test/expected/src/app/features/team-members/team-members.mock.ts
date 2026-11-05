import { TeamMembersVm } from './team-members.models';

// Mock data for previews and stakeholder review: one per state frame in Figma,
// filled from the frame's content. Frontend replaces this with real data.
export const TEAM_MEMBERS_DEFAULT: TeamMembersVm = {
  state: 'default',
  members: [
    { id: 'member-1', name: 'Lina Haddad', email: 'lina@acme.io', badge: 'active' },
    { id: 'member-2', name: 'Omar Khalil', email: 'omar@acme.io', badge: 'active' },
    { id: 'member-3', name: 'Sara Nasser', email: 'sara@acme.io', badge: 'invited' },
    { id: 'member-4', name: 'Yousef Ali', email: 'yousef@acme.io', badge: 'suspended' },
  ],
};

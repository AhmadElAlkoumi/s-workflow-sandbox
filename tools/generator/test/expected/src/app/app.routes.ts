import { Routes } from '@angular/router';
import { TEAM_MEMBERS_DEFAULT } from './features/team-members/team-members.mock';

// Feature routes are added here by designer PRs (presentational pages with mocks)
// and later wired to real data by frontend.
const teamMembers = () => import('./features/team-members/team-members.page').then(m => m.TeamMembersPage);

export const routes: Routes = [
  // Preview routes for team-members (Ship to Frontend): one per state, so stakeholders and QA can open each directly.
  { path: 'team-members', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_DEFAULT } },
  { path: '', redirectTo: 'team-members', pathMatch: 'full' },
];

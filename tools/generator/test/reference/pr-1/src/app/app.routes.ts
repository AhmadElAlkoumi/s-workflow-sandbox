import { Routes } from '@angular/router';
import {
  TEAM_MEMBERS_EMPTY,
  TEAM_MEMBERS_ERROR,
  TEAM_MEMBERS_LOADING,
  TEAM_MEMBERS_LONG,
  TEAM_MEMBERS_READY,
} from './features/team-members/team-members.mock';

// Feature routes are added here by designer PRs (presentational pages with mocks)
// and later wired to real data by frontend.
const teamMembers = () => import('./features/team-members/team-members.page').then(m => m.TeamMembersPage);

export const routes: Routes = [
  // Preview routes: one per state, so stakeholders and QA can open each directly.
  { path: 'team-members', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_READY } },
  { path: 'team-members/empty', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_EMPTY } },
  { path: 'team-members/long', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_LONG } },
  { path: 'team-members/loading', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_LOADING } },
  { path: 'team-members/error', loadComponent: teamMembers, data: { vm: TEAM_MEMBERS_ERROR } },
  { path: '', redirectTo: 'team-members', pathMatch: 'full' },
];

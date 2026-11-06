import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DsButtonComponent, DsCardComponent, DsInputComponent } from '@ds/ui';
import { MemberRowComponent } from './member-row.component';
import { TeamMember, TeamMembersVm } from './team-members.models';

// Figma: Screens / Team members / default  (node 4:11)
// Presentational only. Data comes in through `vm`, user intent goes out through outputs.
// Frontend connects `vm` to the real API and handles the outputs.
@Component({
  selector: 'app-team-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsButtonComponent, DsCardComponent, DsInputComponent, MemberRowComponent],
  template: `
    <header class="header">
      <div class="title">
        <h1>Team members</h1>
        @if (ready(); as r) {
          <p>Manage who has access to the {{ r.workspaceName }} workspace.</p>
        }
      </div>
      <ds-button variant="primary" size="md" (pressed)="inviteClicked.emit()">Invite member</ds-button>
    </header>

    @switch (vm().state) {
      @case ('loading') {
        <ds-card title="Loading members…" description="This usually takes a second." />
      }
      @case ('error') {
        <ds-card title="Something went wrong" [description]="errorMessage()">
          <ds-button variant="secondary" size="sm" (pressed)="retry.emit()">Try again</ds-button>
        </ds-card>
      }
      @case ('ready') {
        @let team = ready()!;
        <section class="stats" aria-label="Team summary">
          <ds-card [title]="team.stats.active + ' active'" description="Members with access today" />
          <ds-card [title]="team.stats.pending + ' pending'" description="Invites waiting for a response" />
          <ds-card [title]="team.stats.suspended + ' suspended'" description="Access paused by an admin" />
        </section>

        <form class="invite" (submit)="$event.preventDefault(); submitInvite()">
          <ds-input
            class="invite__email"
            type="email"
            label="Invite by email"
            placeholder="teammate@acme.io"
            hint="They will get an email with a link to join."
            [(value)]="inviteEmail" />
          <ds-button variant="secondary" size="md" type="submit">Send invite</ds-button>
        </form>

        @if (team.members.length) {
          <section class="members" aria-label="Members">
            @for (m of team.members; track m.id) {
              <app-member-row [member]="m" (manage)="manage.emit($event)" />
            }
          </section>
        } @else {
          <ds-card title="No members yet" description="Invite your first teammate to start collaborating." />
        }
      }
    }
  `,
  styleUrl: './team-members.page.scss',
})
export class TeamMembersPage {
  readonly vm = input.required<TeamMembersVm>();

  readonly inviteClicked = output<void>();
  readonly invite = output<string>();
  readonly manage = output<TeamMember>();
  readonly retry = output<void>();

  protected readonly ready = computed(() => {
    const vm = this.vm();
    return vm.state === 'ready' ? vm : null;
  });
  protected readonly errorMessage = computed(() => {
    const vm = this.vm();
    return vm.state === 'error' ? vm.message : '';
  });

  protected readonly inviteEmail = signal('');

  protected submitInvite(): void {
    const email = this.inviteEmail().trim();
    if (email) this.invite.emit(email);
  }
}

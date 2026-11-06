import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DsBadgeComponent, DsBadgeTone, DsButtonComponent } from '@ds/ui';
import { Member, MemberBadge } from './team-members.models';

// Figma: Screens / _MemberRow (feature-level, not part of @ds/ui)
const BADGE: Record<MemberBadge, { tone: DsBadgeTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  invited: { tone: 'brand', label: 'Invited' },
  suspended: { tone: 'danger', label: 'Suspended' },
};

@Component({
  selector: 'app-member-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DsBadgeComponent, DsButtonComponent],
  template: `
    <div class="who">
      <span class="name">{{ member().name }}</span>
      <span class="email">{{ member().email }}</span>
    </div>
    <ds-badge [tone]="badge().tone">{{ badge().label }}</ds-badge>
    <ds-button variant="ghost" size="sm" (pressed)="manage.emit(member())">Manage</ds-button>
  `,
  styleUrl: './member-row.component.scss',
})
export class MemberRowComponent {
  readonly member = input.required<Member>();
  readonly manage = output<Member>();
  protected readonly badge = computed(() => BADGE[this.member().badge]);
}

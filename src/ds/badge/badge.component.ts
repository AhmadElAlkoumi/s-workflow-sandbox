import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type DsBadgeTone = 'neutral' | 'brand' | 'success' | 'danger';

/**
 * Figma: Components / Badge  (tone, text prop "label")
 */
@Component({
  selector: 'ds-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'ds-badge ds-badge--' + tone()" },
  template: `<ng-content />`,
  styleUrl: './badge.component.scss',
})
export class DsBadgeComponent {
  readonly tone = input<DsBadgeTone>('neutral');
}

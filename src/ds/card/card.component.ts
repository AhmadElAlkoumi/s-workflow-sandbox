import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Figma: Components / Card  (text props "title", "description")
 * Extra content can be projected below the description.
 */
@Component({
  selector: 'ds-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (title()) { <h3 class="ds-card__title">{{ title() }}</h3> }
    @if (description()) { <p class="ds-card__description">{{ description() }}</p> }
    <ng-content />
  `,
  styleUrl: './card.component.scss',
})
export class DsCardComponent {
  readonly title = input('');
  readonly description = input('');
}

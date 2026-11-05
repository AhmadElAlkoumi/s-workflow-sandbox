import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type DsButtonVariant = 'primary' | 'secondary' | 'ghost';
export type DsButtonSize = 'sm' | 'md';

/**
 * Figma: Components / Button  (variant × size, text prop "label")
 * Inputs mirror the Figma properties one to one.
 */
@Component({
  selector: 'ds-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="'ds-button ds-button--' + variant() + ' ds-button--' + size()"
      [attr.type]="type()"
      [disabled]="disabled()"
      (click)="pressed.emit($event)">
      <ng-content />
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class DsButtonComponent {
  readonly variant = input<DsButtonVariant>('primary');
  readonly size = input<DsButtonSize>('md');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly pressed = output<MouseEvent>();
}

import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export type DsInputState = 'default' | 'error';

let nextId = 0;

/**
 * Figma: Components / Input  (state, text props "label", "placeholder", "hint")
 */
@Component({
  selector: 'ds-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ds-input__label" [attr.for]="id">{{ label() }}</label>
    <input
      class="ds-input__field"
      [class.ds-input__field--error]="state() === 'error'"
      [id]="id"
      [attr.type]="type()"
      [placeholder]="placeholder()"
      [value]="value()"
      [attr.aria-invalid]="state() === 'error'"
      [attr.aria-describedby]="hint() ? id + '-hint' : null"
      (input)="value.set($any($event.target).value)" />
    @if (hint()) {
      <span class="ds-input__hint" [class.ds-input__hint--error]="state() === 'error'" [id]="id + '-hint'">
        {{ hint() }}
      </span>
    }
  `,
  styleUrl: './input.component.scss',
})
export class DsInputComponent {
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly hint = input('');
  readonly state = input<DsInputState>('default');
  readonly type = input<'text' | 'email' | 'password' | 'search'>('text');
  readonly value = model('');
  protected readonly id = `ds-input-${nextId++}`;
}

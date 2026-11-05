// url=<FIGMA_DS_FILE>?node-id=2-60
// source=src/ds/button/button.component.ts
// component=DsButtonComponent
import figma from 'figma'
const instance = figma.selectedInstance

const label = instance.getString('label')
const variant = instance.getEnum('variant', {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'ghost',
})
const size = instance.getEnum('size', {
  sm: 'sm',
  md: 'md',
})

export default {
  example: figma.code`<ds-button variant="${variant}" size="${size}">${label}</ds-button>`,
  imports: ["import { DsButtonComponent } from '@ds/ui';"],
  id: 'ds-button',
  metadata: { nestable: true },
}

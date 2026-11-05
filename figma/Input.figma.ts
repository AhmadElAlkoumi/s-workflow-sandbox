// url=<FIGMA_DS_FILE>?node-id=2-71
// source=src/ds/input/input.component.ts
// component=DsInputComponent
import figma from 'figma'
const instance = figma.selectedInstance

const label = instance.getString('label')
const placeholder = instance.getString('placeholder')
const hint = instance.getString('hint')
const state = instance.getEnum('state', {
  default: 'default',
  error: 'error',
})

export default {
  example: figma.code`<ds-input label="${label}" placeholder="${placeholder}" hint="${hint}" state="${state}" />`,
  imports: ["import { DsInputComponent } from '@ds/ui';"],
  id: 'ds-input',
  metadata: { nestable: true },
}

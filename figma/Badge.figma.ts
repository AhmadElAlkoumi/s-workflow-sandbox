// url=<FIGMA_DS_FILE>?node-id=2-80
// source=src/ds/badge/badge.component.ts
// component=DsBadgeComponent
import figma from 'figma'
const instance = figma.selectedInstance

const label = instance.getString('label')
const tone = instance.getEnum('tone', {
  neutral: 'neutral',
  brand: 'brand',
  success: 'success',
  danger: 'danger',
})

export default {
  example: figma.code`<ds-badge tone="${tone}">${label}</ds-badge>`,
  imports: ["import { DsBadgeComponent } from '@ds/ui';"],
  id: 'ds-badge',
  metadata: { nestable: true },
}

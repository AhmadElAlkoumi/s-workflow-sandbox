// url=<FIGMA_DS_FILE>?node-id=2-81
// source=src/ds/card/card.component.ts
// component=DsCardComponent
import figma from 'figma'
const instance = figma.selectedInstance

const title = instance.getString('title')
const description = instance.getString('description')

export default {
  example: figma.code`<ds-card title="${title}" description="${description}"></ds-card>`,
  imports: ["import { DsCardComponent } from '@ds/ui';"],
  id: 'ds-card',
  metadata: { nestable: true },
}

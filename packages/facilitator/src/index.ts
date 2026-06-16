import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { serve } from '@hono/node-server'
import { loadFacilitatorConfig } from './config'
import { createFacilitator } from './app'

export { createFacilitator, createApp } from './app'
export { loadFacilitatorConfig } from './config'
export { PolicyEngine } from './policy'
export type { Policy, PolicyReason, PolicyResult } from './policy'
export * from './types'

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const cfg = loadFacilitatorConfig()
  const here = dirname(fileURLToPath(import.meta.url)) // packages/facilitator/src
  const uiPath = process.env.UI_HTML ?? join(here, '..', '..', '..', 'apps', 'wall', 'index.html')
  const hasUi = existsSync(uiPath)
  const { app, facilitatorLabel } = createFacilitator(cfg, { uiHtmlPath: hasUi ? uiPath : undefined })
  const port = Number(process.env.PORT ?? 8402)
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `cx402 facilitator listening on :${info.port}\n` +
        `  ui=${hasUi ? uiPath : '(none)'}\n` +
        `  network=${cfg.network} asset=${cfg.settlementAsset}\n` +
        `  mode=${cfg.settlementMode} facilitator=${facilitatorLabel}`,
    )
  })
}

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
export { MandateVerifier, canonicalMandate } from './mandate'
export type { Mandate, SignedMandate, MandateError } from './mandate'
export { PaymentIntentVerifier, canonicalIntent } from './intent'
export type { PaymentIntent, SignedPaymentIntent, IntentError } from './intent'
export * from './types'

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const cfg = loadFacilitatorConfig()
  const here = dirname(fileURLToPath(import.meta.url)) // packages/facilitator/src
  const uiPath = process.env.UI_HTML ?? join(here, '..', '..', '..', 'apps', 'wall', 'index.html')
  const hasUi = existsSync(uiPath)
  const { app, facilitatorLabel } = createFacilitator(cfg, { uiHtmlPath: hasUi ? uiPath : undefined })
  const port = Number(process.env.PORT ?? 8402)
  // bind all interfaces so container hosts (Railway/Render) can route to it;
  // @hono/node-server otherwise defaults to localhost, unreachable from outside
  const hostname = process.env.HOST ?? '0.0.0.0'
  serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(
      `cx402 facilitator listening on ${hostname}:${info.port}\n` +
        `  ui=${hasUi ? uiPath : '(none)'}\n` +
        `  network=${cfg.network} asset=${cfg.settlementAsset}\n` +
        `  mode=${cfg.settlementMode} facilitator=${facilitatorLabel}`,
    )
  })
}

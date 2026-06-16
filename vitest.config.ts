import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // live sandbox + on-chain calls hit the network — give them room
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'],
    // transpile our workspace packages (they export raw .ts source)
    server: { deps: { inline: [/@cx402\//] } },
    // on-chain settles share one facilitator wallet — run files serially to avoid nonce races
    fileParallelism: false,
  },
})

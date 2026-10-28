/**
 * Plumbing. DO NOT EDIT.
 */
export { createBackup } from './backups'
export { main } from './main'
export { init, uninit } from './init'
export { actions } from './actions'
import { buildManifest } from '@start9labs/start-sdk'
import { manifest as sdkManifest } from './manifest'
import { versionGraph } from './versions'
import { dependencies } from './dependencies'
const builtManifest = buildManifest(versionGraph, sdkManifest, dependencies)
// The SDK no longer exposes emulateMissingAs, but start-cli needs it for i2pd (no riscv64 image).
export const manifest = {
  ...builtManifest,
  images: {
    ...builtManifest.images,
    i2pd: { ...builtManifest.images.i2pd, emulateMissingAs: 'x86_64' },
  },
}

import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
import { rm } from 'fs/promises'
import { bitcoinConfFile } from '../fileModels/bitcoin.conf'

export const current = VersionInfo.of({
  version: '#knots:29.5.0:5',
  releaseNotes: {
    en_US: `I2P uses the standalone I2Pd service. Bitcoin no longer creates its own I2P address or exposes I2P SAM settings. Add a .b32.i2p address on the Peer interface for inbound connections.`,
  },
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
    other: {
      // `#knotsrdts` (the "Bitcoin Knots plus BIP-110" build) is being
      // retired. Users on it can move here; preserve their RDTS acceptance
      // so the consensusrules critical-task gate doesn't re-fire. No
      // `down` — `#knotsrdts` is being de-listed, so the inverse path
      // can't be selected by a user.
      ['^#knotsrdts:29.3']: {
        up: async ({ effects }) => {},
      },
    },
  },
})

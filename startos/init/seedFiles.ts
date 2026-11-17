import {
  archivalMin,
  bitcoinConfFile,
  defaultDatacarriercost,
  defaultDbbatchsize,
  defaultDbcache,
  diskUsage,
  minPrune,
} from '../fileModels/bitcoin.conf'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'

export const seedFiles = sdk.setupOnInit(async (effects, kind) => {
  if (!kind) return

  // install, update, restore
  await storeJson.merge(effects, {})

  if (kind === 'install') {
    await bitcoinConfFile.merge(effects, {
      zmqEnabled: true,
      blockfilters: { blockfilterindex: true },
      dbcache: defaultDbcache(),
      dbbatchsize: defaultDbbatchsize(),
      natpmp: false,
      datacarriercost: defaultDatacarriercost,
      prune: (await diskUsage()).total < archivalMin ? minPrune : 0,
    })
  } else {
    // Remove the SAM settings that made bitcoind generate its own address.
    await bitcoinConfFile.merge(effects, {
      raw: { i2psam: undefined, i2pacceptincoming: undefined },
    })
  }
})

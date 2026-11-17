import { TOML } from '@start9labs/start-sdk'
import { access, rm, writeFile } from 'fs/promises'
import {
  samHostId,
  samPort,
  socksHostId as i2pSocksHostId,
  socksPort as i2pSocksPort,
} from 'i2pd-startos/startos/utils'
import { socksHostId, socksPort } from 'tor-startos/startos/utils'
import { bitcoinConfFile } from './fileModels/bitcoin.conf'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  bitcoinCliArgs,
  bitcoinMounts,
  GetBlockchainInfo,
  rootDir,
  rpccookiefile,
  rpcPort,
  rpcPortPruned,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  /**
   * ======================== Setup ========================
   */
  console.log('Starting Bitcoin!')

  // get store.json but don't watch for changes
  const store = await storeJson.read().once()
  if (!store) {
    throw new Error('No store')
  }
  // get bitcoin.conf and watch for changes
  const bitcoinConf = await bitcoinConfFile.read().const(effects)
  if (!bitcoinConf) {
    throw new Error('No bitcoin.conf')
  }

  const { reindexBlockchain, reindexChainstate } = store

  // Tor SOCKS over the bridge. The bridge address only changes when tor's
  // binding does — with the 9050 fallback it stays constant across tor
  // install/update/uninstall, so this .const() never restarts Bitcoin unless
  // tor lands on a different port (then one healing restart). A dead bridge
  // address is just connection-refused, so -onion is always safe to pass.
  const torSocks = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'tor',
      hostId: socksHostId,
      internalPort: socksPort,
      fallbackPort: socksPort,
    })
    .const()

  // I2Pd SAM and SOCKS, same contract as Tor. The port fallback keeps the
  // address stable across i2pd install and removal. -i2pacceptincoming=0
  // below uses a transient SAM session for outbound only: a persistent
  // session would write i2p_private_key and advertise that address. Inbound
  // is solely the .b32.i2p address I2Pd exports onto the peer interface.
  const i2pSam = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'i2pd',
      hostId: samHostId,
      internalPort: samPort,
      fallbackPort: samPort,
    })
    .const()
  const i2pSocks = await sdk.host
    .getBridgeAddress(effects, {
      packageId: 'i2pd',
      hostId: i2pSocksHostId,
      internalPort: i2pSocksPort,
      fallbackPort: i2pSocksPort,
    })
    .const()

  // track Tor install/run state dynamically for the health check (no restart)
  let torInstalled = false
  let torRunning = false
  sdk.getStatus(effects, { packageId: 'tor' }).onChange((status) => {
    torInstalled = status !== null
    torRunning = status?.desired.main === 'running'
    return { cancel: false }
  })

  let i2pInstalled = false
  let i2pRunning = false
  sdk.getStatus(effects, { packageId: 'i2pd' }).onChange((status) => {
    i2pInstalled = status !== null
    i2pRunning = status?.desired.main === 'running'
    return { cancel: false }
  })

  const externalip = bitcoinConf.raw?.externalip
  const onlynetList = [bitcoinConf.onlynet ?? []].flat()
  const onlynetActive = onlynetList.length > 0
  const i2pExcluded = onlynetActive && !onlynetList.includes('i2p')

  const bitcoinArgs: string[] = [`-onion=${torSocks}`]
  if (!i2pExcluded) {
    bitcoinArgs.push(`-i2psam=${i2pSam}`, '-i2pacceptincoming=0')
  }

  if (reindexBlockchain) {
    bitcoinArgs.push('-reindex')
    await storeJson.merge(effects, { reindexBlockchain: false })
  } else if (reindexChainstate) {
    bitcoinArgs.push('-reindex-chainstate')
    await storeJson.merge(effects, { reindexChainstate: false })
  }

  const bitcoindSub = await sdk.SubContainer.eager(
    effects,
    { imageId: 'bitcoind' },
    bitcoinMounts,
    'bitcoind-sub',
  )

  const rpcCookiePath = `${rootDir}/${rpccookiefile}`

  // remove cookie file
  await rm(`${bitcoindSub.rootfs}${rpcCookiePath}`, {
    force: true,
    recursive: true,
  })
  // Drop a destination minted by an older package. Inbound is the address
  // I2Pd publishes, and -i2pacceptincoming=0 will not recreate this file.
  await rm(`${bitcoindSub.rootfs}${rootDir}/i2p_private_key`, { force: true })

  /**
   * ======================== Daemons ========================
   *
   * Unconditional daemons are chained synchronously on baseDaemons.
   * The proxy daemon uses an async factory that returns null to skip or
   * params to include. Type assertions (as [...]) are needed because async
   * factories weaken TypeScript's contextual typing.
   */

  const excludedByOnlynetResult = () => ({
    result: 'disabled' as const,
    message: i18n('Excluded by onlynet'),
  })

  // ---- Build daemon chain step by step ----

  const base = sdk.Daemons.of(effects).addOneshot('nocow', {
    subcontainer: bitcoindSub,
    exec: {
      command: ['chattr', '-R', '+C', rootDir],
    },
    requires: [],
  })

  const withBitcoind = await base
    .addDaemon('bitcoind', {
      subcontainer: bitcoindSub,
      exec: {
        command: ['bitcoind', ...bitcoinArgs],
        sigtermTimeout: 300_000,
      },
      ready: {
        display: 'RPC',
        fn: async () => {
          try {
            await access(`${bitcoindSub.rootfs}${rpcCookiePath}`)
          } catch {
            console.log('Waiting for cookie to be created')
            return {
              message: i18n('The Bitcoin RPC Interface is not ready'),
              result: 'starting',
            }
          }

          return sdk.healthCheck.checkPortListening(
            effects,
            bitcoinConf.prune ? rpcPortPruned : rpcPort,
            {
              successMessage: i18n('The Bitcoin RPC Interface is ready'),
              errorMessage: i18n('The Bitcoin RPC Interface is not ready'),
            },
          )
        },
      },
      requires: ['nocow'],
    })
    .addHealthCheck('sync-progress', {
      ready: {
        display: i18n('Blockchain Sync'),
        trigger: sdk.trigger.statusTrigger(30_000, {
          starting: 5_000,
          failure: 5_000,
        }),
        fn: async () => {
          const res = await bitcoindSub.exec([
            ...bitcoinCliArgs({ prune: !!bitcoinConf.prune }),
            '-rpcconnect=127.0.0.1',
            'getblockchaininfo',
          ])

          if (
            res.exitCode === 0 &&
            res.stdout !== '' &&
            typeof res.stdout === 'string'
          ) {
            const info: GetBlockchainInfo = JSON.parse(res.stdout)

            if (info.initialblockdownload) {
              const percentage = (info.verificationprogress * 100).toFixed(2)
              return {
                message: i18n('Syncing blocks...${percentage}%', {
                  percentage,
                }),
                result: 'loading',
              }
            }

            return {
              message: i18n('Bitcoin is fully synced'),
              result: 'success',
            }
          }

          return {
            message: i18n('Bitcoin is starting…'),
            result: 'starting',
          }
        },
      },
      requires: ['bitcoind'],
    })
    .addOneshot('synced-true', {
      subcontainer: null,
      exec: {
        fn: async () => {
          if (!store.fullySynced) {
            await sdk.notification.create(effects, {
              level: 'success',
              title: i18n('Sync Complete'),
              message: i18n('The blockchain is fully synced.'),
            })
            await storeJson.merge(effects, {
              fullySynced: true,
              snapshotInUse: false,
            })
            // Keep the in-memory guard in sync so a sync-progress dip and
            // recovery within this run doesn't re-fire the notification.
            store.fullySynced = true
            // Reduce dbcache and dbbatchsize after initial sync to free RAM
            await bitcoinConfFile.merge(effects, {
              dbcache: undefined,
              dbbatchsize: undefined,
            })
          }

          return null
        },
      },
      requires: ['sync-progress'],
    })

  const withI2p = withBitcoind.addHealthCheck('i2p', {
    ready: {
      display: 'I2P',
      fn: () => {
        if (!i2pInstalled) {
          return { result: 'disabled', message: i18n('I2P is not installed') }
        }
        if (!i2pRunning) {
          return { result: 'disabled', message: i18n('I2P is not running') }
        }
        if (i2pExcluded) return excludedByOnlynetResult()
        return {
          result: 'success',
          message: externalip?.some((ip) => ip?.includes('.b32.i2p'))
            ? i18n('Inbound and outbound connections')
            : i18n('Outbound only. Add an I2P address to enable inbound.'),
        }
      },
    },
    requires: [],
  })

  // Tor
  const withTor = withI2p.addHealthCheck('tor', {
    ready: {
      display: 'Tor',
      fn: () => {
        if (!torInstalled) {
          return { result: 'disabled', message: i18n('Tor is not installed') }
        }
        if (!torRunning) {
          return { result: 'disabled', message: i18n('Tor is not running') }
        }
        if (onlynetActive && !onlynetList.includes('onion')) {
          return excludedByOnlynetResult()
        }
        return {
          result: 'success',
          message: externalip?.some((ip) => ip?.includes('.onion'))
            ? i18n('Inbound and outbound connections')
            : i18n('Outbound only. Add an onion address to enable inbound.'),
        }
      },
    },
    requires: [],
  })

  // Clearnet
  const withClearnet = withTor.addHealthCheck('clearnet', {
    ready: {
      display: 'Clearnet',
      fn: () => {
        if (
          onlynetActive &&
          !onlynetList.includes('ipv4') &&
          !onlynetList.includes('ipv6')
        ) {
          return excludedByOnlynetResult()
        }
        return {
          result: 'success',
          message: externalip?.some((ip) => ip && !ip.includes('.onion'))
            ? i18n('Inbound and outbound connections')
            : i18n('Outbound only. Publish an IP address to enable inbound.'),
        }
      },
    },
    requires: [],
  })

  // RPC proxy (conditional, enabled when pruning)
  return withClearnet.addDaemon('proxy', async () => {
    if (!bitcoinConf.prune) return null

    const subcontainer = await sdk.SubContainer.eager(
      effects,
      { imageId: 'proxy' },
      bitcoinMounts,
      'proxy-sub',
    )

    await writeFile(
      `${subcontainer.rootfs}/config.toml`,
      TOML.stringify({
        bitcoind_address: '127.0.0.1',
        bitcoind_port: rpcPortPruned,
        bind_address: '0.0.0.0',
        bind_port: rpcPort,
        cookie_file: rpcCookiePath,
        tor_proxy: torSocks,
        tor_only: onlynetList.length === 1 && onlynetList[0] === 'onion',
        // Users derived from the two passthrough sources carry no explicit
        // fetch_blocks, so this global switch is what grants them on-demand
        // fetching of pruned blocks over p2p. Without it the proxy forwards
        // every getblock straight to bitcoind.
        default_fetch_blocks: true,
        // Unset, the proxy asks every eligible peer for the same block at once
        // and keeps the first valid answer — N copies of every fetch.
        max_peer_concurrency: 3,
        // Peers reachable only over I2P need I2Pd's SOCKS proxy; the fetcher
        // reaches clearnet and .onion peers on its own.
        ...(!i2pExcluded ? { i2p_proxy: i2pSocks } : {}),
        passthrough_rpcauth: `${rootDir}/bitcoin.conf`,
        passthrough_rpccookie: rpcCookiePath,
      }),
    )

    return {
      subcontainer,
      exec: {
        // The verbosity counter starts at Critical, a level the proxy has no
        // call sites for, so unraised it cannot report a failure at all.
        command: [
          '/usr/bin/btc_rpc_proxy',
          '--conf',
          '/config.toml',
          '-vv',
        ] as [string, ...string[]],
      },
      ready: {
        display: i18n('RPC Proxy'),
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, rpcPort, {
            successMessage: i18n('The Bitcoin RPC Proxy is ready'),
            errorMessage: i18n('The Bitcoin RPC Proxy is not ready'),
          }),
      },
      requires: ['bitcoind' as const],
    }
  })
})

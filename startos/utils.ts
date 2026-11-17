import { T } from '@start9labs/start-sdk'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'

// Host ids (the `sdk.MultiHost.of` groups) — distinct from the interface ids
// exported on them. Used for `sdk.host.getOwn`/`get` lookups.
export const rpcHostId = 'rpc'
export const peerHostId = 'peer'
export const zmqHostId = 'zmq'

/**
 * The whitelisted p2p listener, for services on the LXC bridge. Bound without
 * an exported interface, so it is reachable only over the bridge — a dependent
 * resolves it with `sdk.host.getBridgeAddress({ hostId: peerLocalHostId,
 * internalPort: peerPortLocal })`.
 *
 * A dependent that fetches blocks over p2p (electrs, NBXplorer) must use this
 * host rather than `peerHostId`: the latter maps onto the plain `bind`, where
 * it lands with no permissions alongside public inbound peers.
 */
export const peerLocalHostId = 'peer-local'

// Interface ids (the exported service interfaces on the hosts above).
export const rpcInterfaceId = 'rpc'
export const peerInterfaceId = 'peer'
export const zmqBlockInterfaceId = 'zmq-block'
export const zmqTxInterfaceId = 'zmq-tx'

export const zmqPortBlock = 28332
export const zmqPortTransaction = 28333

/** Host-side port the public `peer` binding prefers — the canonical p2p port. */
export const peerPortExternal = 8333
/** Container port bitcoind plain-binds (`bind`); the `peer` binding maps here. */
export const peerPortInternal = 58333
/** Container port bitcoind whitelists (`whitebind`); the `peer-local` binding maps here. */
export const peerPortLocal = 58334

export const rpcPort = 8332
export const rpcPortPruned = 58332

export const rpcbind = `0.0.0.0:${rpcPort}`
export const rpcbindPruned = `127.0.0.1:${rpcPortPruned}`

export const rpcallowip = '0.0.0.0/0'
export const rpcallowipPruned = '127.0.0.1/32'

export const rootDir = '/root/.bitcoin'
export const rpccookiefile = '.cookie'

export const bitcoinMounts = sdk.Mounts.of().mountVolume({
  volumeId: 'main',
  subpath: null,
  mountpoint: rootDir,
  readonly: false,
})

export type GetNetworkInfo = {
  connections: number
  connections_in: number
  connections_out: number
}

export type GetBlockchainInfo = {
  chain: string
  blocks: number
  headers: number
  bestblockhash: string
  difficulty: number
  mediantime: number
  verificationprogress: number
  initialblockdownload: boolean
  chainwork: string
  size_on_disk: number
  pruned: boolean
  pruneheight?: number
  automatic_pruning?: boolean
  prune_target_size?: number
  softforks: Record<
    string,
    {
      type: string
      bip9?: {
        status: string
        bit?: number
        start_time: number
        timeout: number
        since: number
        statistics?: {
          period: number
          threshold: number
          elapsed: number
          count: number
          possible: boolean
        }
      }
      height?: number
      active: boolean
    }
  >
  warnings: string
}

/** RPC connection args shared by bitcoin-cli and shell-script wrappers.
 *  Pass `wallet` to scope a wallet RPC to a specific wallet — required once
 *  more than one wallet is loaded, or bitcoind fails with error -19. */
export function rpcArgs(opts: { prune: boolean; wallet?: string }): string[] {
  return [
    `-conf=${rootDir}/bitcoin.conf`,
    `-rpccookiefile=${rootDir}/.cookie`,
    `-rpcport=${opts.prune ? rpcPortPruned : rpcPort}`,
    ...(opts.wallet !== undefined ? [`-rpcwallet=${opts.wallet}`] : []),
  ]
}

/** Full bitcoin-cli command prefix for actions running in temp subcontainers. */
export function bitcoinCliArgs(opts: {
  prune: boolean
  wallet?: string
}): string[] {
  return ['bitcoin-cli', ...rpcArgs(opts)]
}

/** Historical hardcoded wallet name used by the Wallet-group Actions. */
export const defaultWalletName = 'coin'

/** Display label for a wallet name — bitcoind's default wallet is '' (empty). */
export function walletLabel(name: string): string {
  return name === '' ? i18n('(default wallet)') : name
}

/** The wallet the Wallet-group Actions are currently pointed at
 *  (set via the Select Wallet action, defaults to `coin`).
 *  Pass `effects` to subscribe reactively (metadata builders); omit it for a
 *  one-shot read (execution functions). */
export async function getSelectedWallet(effects?: T.Effects): Promise<string> {
  const store = effects
    ? await storeJson.read().const(effects)
    : await storeJson.read().once()
  return store?.selectedWallet ?? defaultWalletName
}

/** True if `name` is safe to embed in a filesystem path under the datadir.
 *  Notably rejects the default wallet '' (its wallet dir IS the datadir root)
 *  and anything containing path separators. */
export function isPathSafeWalletName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  )
}

/** Make sure the selected wallet is loaded before issuing wallet RPCs.
 *  For the historical default wallet `coin` this preserves the old behavior
 *  of creating it if it doesn't exist yet. For any other wallet we only
 *  attempt a load — "already loaded" errors are ignored via non-failing exec. */
export async function ensureWalletLoaded(
  subc: { exec: (cmd: string[]) => Promise<unknown> },
  opts: { prune: boolean; wallet: string },
): Promise<void> {
  if (opts.wallet === defaultWalletName) {
    await subc.exec([
      'bitcoin-cli',
      ...rpcArgs({ prune: opts.prune }),
      'createwallet',
      defaultWalletName,
    ])
  }
  await subc.exec([
    'bitcoin-cli',
    ...rpcArgs({ prune: opts.prune }),
    'loadwallet',
    opts.wallet,
  ])
}

/** Absolute on-disk path of a wallet's directory. Mirrors bitcoind's
 *  GetWalletDir(): wallets live under `<datadir>/wallets/` when that directory
 *  exists, otherwise directly in the datadir. Callers must pre-validate `wallet`
 *  with isPathSafeWalletName before deleting the returned path. */
export async function resolveWalletDir(
  subc: { exec: (cmd: string[]) => Promise<{ exitCode: number | null }> },
  wallet: string,
): Promise<string> {
  const walletsRoot = `${rootDir}/wallets`
  const hasWalletsRoot =
    (await subc.exec(['test', '-d', walletsRoot])).exitCode === 0
  return `${hasWalletsRoot ? walletsRoot : rootDir}/${wallet}`
}

export const zmqBundle = {
  zmqpubrawblock: `tcp://0.0.0.0:${zmqPortBlock}`,
  zmqpubhashblock: `tcp://0.0.0.0:${zmqPortBlock}`,
  zmqpubrawtx: `tcp://0.0.0.0:${zmqPortTransaction}`,
  zmqpubhashtx: `tcp://0.0.0.0:${zmqPortTransaction}`,
  zmqpubsequence: `tcp://0.0.0.0:${zmqPortTransaction}`,
}

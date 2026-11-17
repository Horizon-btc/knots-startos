# Bitcoin Knots

## Documentation

- [Start9 Bitcoin guides](https://docs.start9.com/bitcoin-guides/) — operating-a-Bitcoin-node guides curated for StartOS users (connecting wallets, dependent services, common workflows).
- [About Bitcoin Knots](https://bitcoinknots.org/#about) — upstream project's description of how Knots differs from Bitcoin Core.
- [About BIP-110 / RDTS](https://bip110.org) — background on the Reduced Data Temporary Softfork network upgrade this version will eventually enforce.

## What you get on StartOS

- A full Bitcoin Knots node with three interfaces: **RPC Interface** (JSON-RPC for wallets and dependent services), **Peer Interface** (the network port other nodes connect to), and **ZeroMQ Interface** (block/transaction notifications, when ZMQ is enabled).
- I2P through the standalone **I2Pd** service. The node reaches I2P peers through that service and does not create an I2P address of its own. Add a `.b32.i2p` address on the Peer Interface to advertise yourself for inbound I2P connections. Router settings and the web console live on the I2Pd service.
- An automatic Tor outbound proxy (your node reaches `.onion` peers without configuration); add a `.onion` to the Peer Interface to advertise yourself and accept inbound Tor connections too.
- Disk-aware defaults: on disks smaller than 900 GB the package enables pruning and disables `txindex`; on larger disks you get a full archival node. The transition is transparent — pruned nodes route RPC through a small `btc-rpc-proxy` sidecar so port 8332 always serves RPC the same way.
- Shared `bitcoind` package id with Bitcoin Core — you can switch flavors without re-syncing the chain.

## Getting set up

Bitcoin Knots starts and begins Initial Block Download (IBD) immediately on install.

1. Start the service. Open the Dashboard and watch the sync progress.
2. If you want inbound clearnet peers, add a public IP or hostname on the **Peer Interface**. If you want inbound Tor peers, add a `.onion` there. If you want inbound I2P peers, add a `.b32.i2p` there.
3. If you want to expose RPC to a wallet or dependent service that doesn't use the cookie file, run **Generate RPC User Credentials** and supply the username/password to the consumer.

> Initial Block Download takes hours to days depending on hardware and network. The node is functional immediately but RPC calls that depend on chain state will return partial results until sync completes.

## Using Bitcoin Knots

### RPC

The **RPC Interface** is where wallets, indexers, Lightning nodes, and other dependent services connect. Internal services on this StartOS authenticate via the cookie file automatically; external clients need an RPC user (see actions below).

### Configuration

Four configuration actions cover the full set of editable `bitcoin.conf` values, grouped to be navigable:

- **Mempool Settings** — Knots' policy controls (OP_RETURN limits, parasite/token filters, replacement rules, ancestor/descendant limits, dust relay fee, etc.) plus standard mempool sizing.
- **Peer Settings** — `onlynet`, BIP324 v2 transport, manual peers, max connections. Inbound I2P uses a `.b32.i2p` address on the Peer Interface, not a setting here.
- **RPC Settings** — RPC threads, work queue, server timeout.
- **Other Settings** — ZMQ, txindex, block templates, coinstats index, block filters (BIP158/157), pruning, dbcache, wallet master switches, NAT-PMP, max upload target, and more.

### RPC users

- **Generate RPC User Credentials** — create a username/password pair for an external client.
- **Delete RPC Users** — remove credentials you no longer need.

### Wallet (on-node wallets)

When wallets are not disabled, the node ships with a basic wallet toolkit you can drive from actions:

- **Select Wallet** — choose which wallet the other Wallet actions operate on. It defaults to `coin`, and the dropdown also lists wallets created by dependent services such as BTCPay Server/NBXplorer (including bitcoind's unnamed default wallet).
- **Get Address**, **Get Balance**, **Send Coin**, **Send All Coin**, **Sign Message**.
- **Backup Wallet** / **Restore Wallet** / **Remove Wallet**.

Every action above acts on the currently selected wallet, so if you run more than one wallet (for example alongside BTCPay Server) use **Select Wallet** to point them at the right one first — otherwise they operate on `coin`. For day-to-day use prefer a dedicated wallet pointed at the RPC interface; the action surface here is mainly for one-off recovery and maintenance.

### Mining

- **Prioritize Transaction** — bump a transaction's relative priority in the mempool with a fee delta.

### Maintenance

- **Reindex Blockchain** — full reindex; expect a long re-sync.
- **Reindex Chainstate** — rebuild chainstate from existing blocks (not available on pruned nodes).
- **Delete Peer List** — wipe `peers.dat` if peer discovery is misbehaving.
- **Delete Transaction Index** / **Delete Coinstats Index** — clear a corrupted index so it can be rebuilt.

### Advanced

- **Download UTXO Snapshot (assumeutxo)** — pull a UTXO snapshot to short-cut IBD; the action hides itself once the node is fully synced. The URL must be a direct link to a `.dat` snapshot file, which can be one you serve from your own machine over the LAN.
- **Runtime Information** — current connection count, block height, sync progress, softfork state, and other runtime details at a glance.

## Limitations

- **Wallet actions cover hot-wallet basics only.** Anything beyond the listed actions (coin control, PSBTs, multisig, hardware-wallet flows) needs an external wallet talking to the RPC interface.
- **I2P router settings live on the I2Pd service.** Bandwidth, transit, floodfill, and the router console are configured there, not in Bitcoin Knots. An embedded router from an older version of this package is not migrated; I2Pd creates its own identity.

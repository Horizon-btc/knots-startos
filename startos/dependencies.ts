import { Dependencies, Dependency } from '@start9labs/start-sdk'
import { bitcoinConfFile } from './fileModels/bitcoin.conf'
import { i2pDescription, torDescription } from './manifest/i18n'

export const dependencies = Dependencies.of()
  .addDependency(
    Dependency.optional('tor', {
      description: torDescription,
      metadata: {
        title: 'Tor',
        icon: 'https://raw.githubusercontent.com/Start9Labs/tor-startos/65faea17febc739d910e8c26ff4e61f6333487a8/icon.svg',
      },
      kind: 'running',
      versionRange: '>=0.4.9.11:4',
      healthChecks: [],
      enabled: async ({ effects }) => {
        const { externalip, onlynet } =
          (await bitcoinConfFile
            .read((b) => ({
              externalip: b.raw?.externalip,
              onlynet: b.onlynet,
            }))
            .const(effects)) ?? {}

        const onlynetList = [onlynet ?? []].flat()

        return (
          !!externalip?.some((ip) => ip?.includes('.onion')) ||
          onlynetList.includes('onion')
        )
      },
    }),
  )
  .addDependency(
    Dependency.optional('i2pd', {
      description: i2pDescription,
      metadata: {
        title: 'I2Pd',
        icon: 'https://raw.githubusercontent.com/Start9Labs/i2pd-startos/9bf4569008e317030ed9efe840837a1d643ce89a/icon.svg',
      },
      kind: 'running',
      versionRange: '>=3.0.0:1',
      healthChecks: [],
      enabled: async ({ effects }) => {
        const { externalip, onlynet } =
          (await bitcoinConfFile
            .read((b) => ({
              externalip: b.raw?.externalip,
              onlynet: b.onlynet,
            }))
            .const(effects)) ?? {}

        const onlynetList = [onlynet ?? []].flat()

        return (
          !!externalip?.some((ip) => ip?.includes('.b32.i2p')) ||
          onlynetList.includes('i2p')
        )
      },
    }),
  )

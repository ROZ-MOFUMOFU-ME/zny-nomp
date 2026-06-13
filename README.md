# BitZeny - Node Open Mining Portal

[![CI](https://img.shields.io/github/actions/workflow/status/ROZ-MOFUMOFU-ME/zny-nomp/node.js.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/actions/workflows/node.js.yml)&nbsp;[![Lint](https://img.shields.io/github/actions/workflow/status/ROZ-MOFUMOFU-ME/zny-nomp/lint-format.yml?branch=main&style=flat-square&logo=prettier&logoColor=white&label=lint)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/actions/workflows/lint-format.yml)&nbsp;[![CircleCI](https://img.shields.io/circleci/build/github/ROZ-MOFUMOFU-ME/zny-nomp/main?style=flat-square&logo=circleci&label=CircleCI)](https://circleci.com/gh/ROZ-MOFUMOFU-ME/zny-nomp/tree/main)&nbsp;[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)&nbsp;[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](https://opensource.org/licenses/MIT)&nbsp;[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/zHUdQy2NzU)

This is a Yescrypt, YesPoWer, YesPoWerSUGAR, YescryptR8G, Lyra2REv2, sha256d, Quark, x11, vipstar and more algo mining pool based off of Node Open Mining Portal. Coins known to work include BitZeny, Koto, Monacoin, Bellcoin, Sugarchain, KumaCoin, Yenten (dev-fee aware) and VIPSTARCOIN.

#### Production Usage Notice

This is beta software. All of the following are things that can change and break an existing ZNY-NOMP setup: functionality of any feature, structure of configuration files and structure of redis data. If you use this software in production then _DO NOT_ pull new code straight into production usage because it can and often will break your setup and require you to tweak things like config files or redis data. _Only tagged releases are considered stable._

#### Paid Solution

Usage of this software requires abilities with sysadmin, database admin, coin daemons, and sometimes a bit of programming. Running a production pool can literally be more work than a full-time job.

### Community

ZNY-NOMP official Discord Server

- Join [https://discord.gg/zHUdQy2NzU](https://discord.gg/zHUdQy2NzU)

If your pool uses ZNY-NOMP let us know and we will list your website here.

### Some pools using ZNY-NOMP or node-stratum-pool module:

- [mofumofu.me - BitZeny Mining Pool](https://zny.mofumofu.me/)

# Usage

#### Requirements

- Coin daemon(s) (find the coin's repo and build latest version from source)
- [Node.js](https://nodejs.org/) v20+, tested up to v24 ([installation instructions](https://nodejs.org/en/download/package-manager)) — v20.17+/22+ is required because the bitcoinjs-lib dependency chain loads an ESM-only module via `require(esm)`
- [Redis](http://redis.io/) key-value store v6.2+ ([follow these instructions](http://redis.io/topics/quickstart)) — the portal uses the node-redis v6 client, which officially supports Redis 6.2 and newer
- A C/C++ toolchain with C++20 support (gcc 10+) and Python, used to build the [multi-hashing](https://github.com/ROZ-MOFUMOFU-ME/node-multi-hashing) native addon pulled in via [node-stratum-pool](https://github.com/ROZ-MOFUMOFU-ME/node-stratum-pool)

#### Development Tools (Optional but Recommended)

- [Prettier](https://prettier.io/) - Code formatter for consistent JavaScript formatting
- [ESLint](https://eslint.org/) - JavaScript linter for code quality

To install development dependencies:

```bash
npm install --save-dev prettier eslint
```

To format code with Prettier:

```bash
npx prettier --write "**/*.js"
```

To lint code with ESLint:

```bash
npx eslint "**/*.js"
```

#### Multi-repository development

This portal depends on [node-stratum-pool](https://github.com/ROZ-MOFUMOFU-ME/node-stratum-pool) which in turn depends on [node-multi-hashing](https://github.com/ROZ-MOFUMOFU-ME/node-multi-hashing); both are pinned to their `main` branches as git dependencies, and all three repositories are developed together on `main` (node-stratum-pool's `main` is protected, so changes there land via pull request). To work on the whole stack locally, clone the three repos side by side and link them:

```bash
cd ../node-multi-hashing && npm link
cd ../node-stratum-pool  && npm link multi-hashing && npm link
cd ../zny-nomp           && npm link stratum-pool
```

##### Seriously

Those are legitimate requirements. If you use old versions of Node.js or Redis that may come with your system package manager then you will have problems. Follow the linked instructions to get the last stable versions.

[**Redis security warning**](http://redis.io/topics/security): be sure firewall access to redis - an easy way is to
include `bind 127.0.0.1` in your `redis.conf` file. Also it's a good idea to learn about and understand software that
you are using - a good place to start with redis is [data persistence](http://redis.io/topics/persistence).

#### 0) Setting up coin daemon

Follow the build/install instructions for your coin daemon. Your coin.conf file should end up looking something like this:

```
daemon=1
rpcuser=username
rpcpassword=password
rpcport=9252
```

For redundancy, its recommended to have at least two daemon instances running in case one drops out-of-sync or offline,
all instances will be polled for block/transaction updates and be used for submitting blocks. Creating a backup daemon
involves spawning a daemon using the `-datadir=/backup` command-line argument which creates a new daemon instance with
it's own config directory and coin.conf file. Learn about the daemon, how to use it and how it works if you want to be
a good pool operator. For starters be sure to read:

- https://en.bitcoin.it/wiki/Running_bitcoind
- https://en.bitcoin.it/wiki/Data_directory
- https://en.bitcoin.it/wiki/Original_Bitcoin_client/API_Calls_list
- https://en.bitcoin.it/wiki/Difficulty

#### 1) Downloading & Installing

Clone the repository and run `npm update` for all the dependencies to be installed:

```bash
sudo apt-get install build-essential libsodium-dev libboost-all-dev libgmp3-dev node-gyp libssl-dev -y
sudo apt install nodejs npm -y
sudo npm install n -g
sudo n stable
sudo apt purge nodejs npm -y
git clone https://github.com/ROZ-MOFUMOFU-ME/zny-nomp
cd zny-nomp
npm install
```

#### 2) Configuration

##### Portal config

Inside the `config_example.json` file, ensure the default configuration will work for your environment, then copy the file to `config.json`.

Explanation for each field:

```javascript
{
    /* Specifies the level of log output verbosity. Anything more severe than the level specified
       will also be logged. */
    "logLevel": "debug", //or "warning", "error"

    /* By default the server logs to console and gives pretty colors. If you direct that output to a
       log file then disable this feature to avoid nasty characters in your log file. */
    "logColors": true,

    /* The server CLI (command-line interface) will listen for commands on this port. For example,
       blocknotify messages are sent to the server through this. */
    "cliPort": 17117,

    /* By default 'forks' is set to "auto" which will spawn one process/fork/worker for each CPU
       core in your system. Each of these workers will run a separate instance of your pool(s),
       and the kernel will load balance miners using these forks. Optionally, the 'forks' field
       can be a number for how many forks will be spawned. */
    "clustering": {
        "enabled": true,
        "forks": "auto"
    },

    /* Pool config file will inherit these default values if they are not set. */
    "defaultPoolConfigs": {

        /* Poll RPC daemons for new blocks every this many milliseconds. */
        "blockRefreshInterval": 1000,

        /* If no new blocks are available for this many seconds update and rebroadcast job. */
        "jobRebroadcastTimeout": 55,

        /* Disconnect workers that haven't submitted shares for this many seconds. */
        "connectionTimeout": 600,

        /* (For MPOS mode) Store the block hashes for shares that aren't block candidates. */
        "emitInvalidBlockHashes": false,

        /* This option will only authenticate miners using an address or mining key. */
        "validateWorkerUsername": true,

        /* Enable for client IP addresses to be detected when using a load balancer with TCP
           proxy protocol enabled, such as HAProxy with 'send-proxy' param:
           http://haproxy.1wt.eu/download/1.5/doc/configuration.txt */
        "tcpProxyProtocol": false,

        /* If under low-diff share attack we can ban their IP to reduce system/network load. If
           running behind HAProxy be sure to enable 'tcpProxyProtocol', otherwise you'll end up
           banning your own IP address (and therefore all workers). */
        "banning": {
            "enabled": true,
            "time": 600, //How many seconds to ban worker for
            "invalidPercent": 50, //What percent of invalid shares triggers ban
            "checkThreshold": 500, //Perform check when this many shares have been submitted
            "purgeInterval": 300 //Every this many seconds clear out the list of old bans
        },

        /* Used for storing share and block submission data and payment processing. */
        "redis": {
            "host": "127.0.0.1",
            "port": 6379
        }
    },

    /* This is the front-end. Its not finished. When it is finished, this comment will say so. */
    "website": {
        "enabled": true,
        /* If you are using a reverse-proxy like nginx to display the website then set this to
           127.0.0.1 to not expose the port. */
        "host": "0.0.0.0",
        "port": 80,
        /* Used for displaying stratum connection data on the Getting Started page. */
        "stratumHost": "cryppit.com",
        "stats": {
            /* Gather stats to broadcast to page viewers and store in redis for historical stats
               every this many seconds. */
            "updateInterval": 15,
            /* How many seconds to hold onto historical stats. Currently set to 24 hours. */
            "historicalRetention": 43200,
            /* How many seconds worth of shares should be gathered to generate hashrate. */
            "hashrateWindow": 300
        },
        /* Not done yet. */
        "adminCenter": {
            "enabled": true,
            "password": "password"
        }
    },

    /* Redis instance of where to store global portal data such as historical stats, proxy states,
       ect.. */
    "redis": {
        "host": "127.0.0.1",
        "port": 6379
    },


    /* With this switching configuration, you can setup ports that accept miners for work based on
       a specific algorithm instead of a specific coin. Miners that connect to these ports are
       automatically switched a coin determined by the server. The default coin is the first
       configured pool for each algorithm and coin switching can be triggered using the
       cli.js script in the scripts folder.

       Miners connecting to these switching ports must use their public key in the format of
       RIPEMD160(SHA256(public-key)). An address for each type of coin is derived from the miner's
       public key, and payments are sent to that address. */
    "switching": {
        "switch1": {
            "enabled": false,
            "algorithm": "sha256",
            "ports": {
                "3333": {
                    "diff": 10,
                    "varDiff": {
                        "minDiff": 16,
                        "maxDiff": 512,
                        "targetTime": 15,
                        "retargetTime": 90,
                        "variancePercent": 30
                    }
                }
            }
        },
        "switch2": {
            "enabled": false,
            "algorithm": "scrypt",
            "ports": {
                "4444": {
                    "diff": 10,
                    "varDiff": {
                        "minDiff": 16,
                        "maxDiff": 512,
                        "targetTime": 15,
                        "retargetTime": 90,
                        "variancePercent": 30
                    }
                }
            }
        },
        "switch3": {
            "enabled": false,
            "algorithm": "x11",
            "ports": {
                "5555": {
                    "diff": 0.001
                }
            }
        }
    },

    "profitSwitch": {
        "enabled": false,
        "updateInterval": 600,
        "depth": 0.90,
        "usePoloniex": true,
        "useCryptsy": true,
        "useMintpal": true
    }
}
```

##### Coin config

Inside the `coins` directory, ensure a json file exists for your coin. If it does not you will have to create it.
Here is an example of the required fields:

```javascript
{
    "name": "BitZeny",
    "symbol": "ZNY",
    "algorithm": "yescryptR8",

    // Coinbase value is what is added to a block when it is mined, set this to your pool name so
    // explorers can see which pool mined a particular block.
    "coinbase": "Bitzeny",
    /* Magic value only required for setting up p2p block notifications. It is found in the daemon
       source code as the pchMessageStart variable.
       For example, BitZeny mainnet magic: https://github.com/BitzenyCoreDevelopers/bitzeny/blob/z2.0.x/src/chainparams.cpp#L114
       And for BitZeny testnet magic: https://github.com/BitzenyCoreDevelopers/bitzeny/blob/z2.0.x/src/chainparams.cpp#L206 */
    "peerMagic": "daa5bef9", //optional
    "peerMagicTestnet": "59454e59" //optional

    //"txMessages": false, //options - defaults to false

    //"mposDiffMultiplier": 256, //options - only for x11 coins in mpos mode
}
```

For additional documentation how to configure coins and their different algorithms
see [these instructions](//github.com/AoD-Technologies/cryptocurrency-stratum-pool#module-usage).

##### Pool config

Take a look at the example json file inside the `pool_configs` directory. Rename it to `bitzeny.json` and change the
example fields to fit your setup.

```
Please Note that: 1 Difficulty is actually 8192, 0.125 Difficulty is actually 1024.

Whenever a miner submits a share, the pool counts the difficulty and keeps adding them as the shares.

ie: Miner 1 mines at 0.1 difficulty and finds 10 shares, the pool sees it as 1 share. Miner 2 mines at 0.5 difficulty and finds 5 shares, the pool sees it as 2.5 shares.
```

```bitzeny.json
{
    "enabled": true, // Enables the mining pool; set to false to disable it.

    "coin": "bitzeny.json", // Specifies the coin configuration file.

    "blockIdentifier": "", // A unique string to be embedded in blocks mined by this pool. Used for identification purposes.
    "_comment_blockIdentifier1": "a string embedded in the block to be mined. Used to identify the pool in Insight etc.",
    "_comment_blockIdentifire2": "If this value equals null string, website.stratumHost in 'config.json' is used.",

    "address": "", // Server wallet address for receiving and sending mining rewards.
    "BTCover17": false, // Indicates whether the pool is using Bitcoin Core version 0.17 or higher.
    "_comment_BTCover17": "If BTC 0.17 or higher, payment does not work please enable it",

    "zAddress": "", // (for KOTO) Server wallet private address used to send tAddress.
    "_comment_zAddress": "a private address used to send coins to tAddress.",

    "tAddress": "", // (for KOTO) Server wallet transparent address used for payouts to miners.
    "_comment_tAddress": "transparent address used to send payments, make this a different address, otherwise payments will not send",

    "walletInterval": 2.5, // (for KOTO) The interval in minutes between wallet operations or updates.

    "rewardRecipients": {
        "": 1.0 // Your wallet addresses and their corresponding reward percentages.
    },

    "urlInsight": "", // (option) Using another explorer
    "_comment_urlInsight": "for using non-default insight: e.g. https://koto-insight-testnet.poolof.work for testnet",

    "paymentProcessing": {
        "minConf": 10, // Minimum number of confirmations for a block before processing payment.
        "enabled": true, // Enables payment processing.
        "paymentMode": "prop", // Payment mode: proportional (prop) or Pay Per Last N Time (pplnt).
        "_comment_paymentMode": "prop, pplnt",
        "paymentInterval": 120, // Payment interval in seconds.
        "minimumPayment": 0.1, // Minimum amount of coins to be paid out.
        "maxBlocksPerPayment": 3, // Maximum number of blocks to include in a single payment.
        "daemon": {
            "host": "127.0.0.1", // Coin daemon RPC server host.
            "port": 9252, // Coin daemon RPC server port.
            "user": "username", // Username for daemon RPC server.
            "password": "password" // Password for daemon RPC server.
        }
    },

    "tlsOptions": {
        "enabled": false, // Enables TLS/SSL; set to true to secure connections.
        "serverKey": "", // Path to the server key file.
        "serverCert": "", // Path to the server certificate file.
        "ca": "" // Path to the certificate authority file.
    },

    "ports": {
        "3031": {
            "diff": 0.5, // Initial difficulty for miners connecting on this port.
            "tls": false, // Specifies whether TLS is enabled for this port.
            "varDiff": {
                "minDiff": 0.00, // Minimum difficulty.
                "maxDiff": 16, // Maximum difficulty.
                "targetTime": 15, // Target time per share (in seconds).
                "retargetTime": 60, // Time to retarget difficulty.
                "variancePercent": 30 // Allowed variance in percent from target time.
            }
        },
         "3032": {  // (Option) Enable multiple difficulty ports
            "diff": 5,
            "tls": false,
            "varDiff": {
                "minDiff": 0.01,
                "maxDiff": 100,
                "targetTime": 15,
                "retargetTime": 60,
                "variancePercent": 30
            }
        }
    },

    "poolId": "main", // Identifier for the mining pool, useful for multi-pool setups.
    "_comment_poolId": "use it for region identification: eu, us, asia or keep default if you have one stratum instance for one coin",

    "daemons": [
        {
            "host": "127.0.0.1", // Host where the coin daemon is running.
            "port": 9252, // Port on which the coin daemon is listening.
            "user": "username", // Username for accessing the coin daemon.
            "password": "password" // Password for accessing the coin daemon.
        }
    ],

    "p2p": {
        "enabled": true, // Enables P2P mode.
        "host": "127.0.0.1", // Host for the P2P server.
        "port": 9253, // Port for the P2P server.
        "disableTransactions": true // Disables transaction messages in P2P mode.
    },

    "mposMode": {
        "enabled": false, // Enables MPOS compatibility mode.
        "host": "127.0.0.1", // Database server host for MPOS mode.
        "port": 3306, // Database server port for MPOS mode.
        "user": "", // Database username.
        "password": "", // Database password.
        "database": "", // Database name.
        "checkPassword": true, // Enables password checking for miners.
        "autoCreateWorker": false // Automatically creates a worker if it doesn't exist.
    }
}
```

##### [Optional, recommended] Setting up blocknotify

1. In `config.json` set the port and password for `blockNotifyListener`
2. In your daemon conf file set the `blocknotify` command to use:

```
node [path to cli.js] [coin name in config] [block hash symbol]
```

Example: inside `bitzeny.conf` add the line

```
blocknotify=node /home/user/zny-nomp/scripts/cli.js blocknotify bitzeny %s
```

Alternatively, you can use a more efficient block notify script written in pure C. Build and usage instructions
are commented in [scripts/blocknotify.c](scripts/blocknotify.c).

#### 3) Start the portal

```bash
npm start
```

###### Optional enhancements for your awesome new mining pool server setup:

- Use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
  in case the master process crashes.
- Use something like [redis-commander](https://github.com/joeferner/redis-commander) to have a nice GUI
  for exploring your redis database.
- Use something like [logrotator](http://www.thegeekstuff.com/2010/07/logrotate-examples/) to rotate log
  output from ZNY-NOMP.
- Use [New Relic](http://newrelic.com/) to monitor your ZNY-NOMP instance and server performance.

#### Upgrading ZNY-NOMP

When updating ZNY-NOMP to the latest code its important to not only `git pull` the latest from this repo, but to also update
the `node-stratum-pool` and `node-multi-hashing` modules, and any config files that may have been changed.

- Inside your ZNY-NOMP directory (where the init.js script is) do `git pull` to get the latest ZNY-NOMP code.
- Remove the dependenices by deleting the `node_modules` directory with `rm -r node_modules`.
- Run `npm update` to force updating/reinstalling of the dependencies.
- Compare your `config.json` and `pool_configs/coin.json` configurations to the latest example ones in this repo or the ones in the setup instructions where each config field is explained. <b>You may need to modify or add any new changes.</b>

## Donations

Donations for development are greatly appreciated!

- ZNY: ZmnBu9jPKvVFL22PcwMHSEuVpTxFeCdvNv
- NUKO: 0xa79bde46faab3c40632604728e9f2165b052581c
- KOTO :k1FTuimwDJ8oo3x23cEBLxovxw5Cqq2U1HK
- SUSU: SeXbMBaax7NgnTEFEMxin5ycXy9r9CDBot
- MONA: MLEqE3vi11j4ZguMjkvMn5rUtze6kXbAzQ
- BELL: BCVicYRSqKKt1ynJKPrXHA46hUWLrbjR49
- SUGAR: sugar1qtwqle9lrr753kxuzqqsh3hv28jl07e3mntx78n
- VIPS: VFixsia2EstV4uEEigUXUrknDGsFeWyNhE
- KUMA: KHjjZ5misqq45zwhj86WKqV8bzqcYExzyM
- BTC: 3FpbJ5cotwPZQn9fcdZrPv4h72XquzEvez
- ETH: 0xc664a0416c23b1b13a18e86cb5fdd1007be375ae
- LTC: Lh96WZ7Rw9Wf4GDX2KXpzieneZFV5Xe5ou
- BCH: pzdsppue8uwc20x35psaqq8sgchkenr49c0qxzazxu
- ETC: 0xc664a0416c23b1b13a18e86cb5fdd1007be375ae

## Credits

### ZNY-NOMP

- [ROZ](https://github.com/ROZ-MOFUMOFU-ME)
- [zinntikumugai](https://github.com/zinntikumugai) - great supporter

### cryptocurrency-stratum-pool

- [Invader444](//github.com/Invader444)

### S-NOMP

- [egyptianbman](https://github.com/egyptianbman)
- [nettts](https://github.com/nettts)
- [potato](https://github.com/zzzpotato)

### K-NOMP

- [yoshuki43](https://github.com/yoshuki43)

### Z-NOMP

- [Joshua Yabut / movrcx](https://github.com/joshuayabut)
- [Aayan L / anarch3](https://github.com/aayanl)
- [hellcatz](https://github.com/hellcatz)

### NOMP

- [Matthew Little / zone117x](https://github.com/zone117x) - developer of NOMP
- [Jerry Brady / mintyfresh68](https://github.com/bluecircle) - got coin-switching fully working and developed proxy-per-algo feature
- [Tony Dobbs](http://anthonydobbs.com) - designs for front-end and created the NOMP logo
- [LucasJones](//github.com/LucasJones) - got p2p block notify working and implemented additional hashing algos
- [vekexasia](//github.com/vekexasia) - co-developer & great tester
- [TheSeven](//github.com/TheSeven) - answering an absurd amount of my questions and being a very helpful gentleman
- [UdjinM6](//github.com/UdjinM6) - helped implement fee withdrawal in payment processing
- [Alex Petrov / sysmanalex](https://github.com/sysmanalex) - contributed the pure C block notify script
- [svirusxxx](//github.com/svirusxxx) - sponsored development of MPOS mode
- [icecube45](//github.com/icecube45) - helping out with the repo wiki
- [Fcases](//github.com/Fcases) - ordered me a pizza <3
- Those that contributed to [node-stratum-pool](//github.com/zone117x/node-stratum-pool#credits)

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. 🔀 Fork this repository
2. 🌿 Create a new branch (`git checkout -b feature/amazing-feature`)
3. 💾 Commit your changes (`git commit -m 'Add some amazing feature'`)
4. 📤 Push to the branch (`git push origin feature/amazing-feature`)
5. 🔃 Open a Pull Request

### 📋 Contributing Guidelines

- Follow the ESLint configuration for code style
- Use Prettier to format your code before committing
- Add tests for new features
- Write clear and descriptive commit messages

#### Code Formatting

Before submitting a pull request, please ensure your code is properly formatted:

```bash
# Format all JavaScript files
npm run format

# Or manually with Prettier
npx prettier --write "**/*.js"

# Check code quality with ESLint
npm run lint

# Or manually with ESLint
npx eslint "**/*.js"
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## 👥 Team

<div align="center">

[![Contributors](https://contrib.rocks/image?repo=ROZ-MOFUMOFU-ME/zny-nomp)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/graphs/contributors)

</div>

---

## 📞 Support

- 🐛 **Bug Reports**: [Issues](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/issues)
- 💡 **Feature Requests**: [Discussions](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/discussions)
- 💬 **Community**: [Discord](https://discord.gg/zHUdQy2NzU)

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ROZ-MOFUMOFU-ME/zny-nomp&type=Date&theme=dark)](https://star-history.com/#ROZ-MOFUMOFU-ME/zny-nomp&Date)

---

## 📊 Statistics

![GitHub Stats](https://github-readme-stats.vercel.app/api?username=ROZ-MOFUMOFU-ME&repo=zny-nomp&show_icons=true&theme=dark)

---

<div align="center">

**⭐ If you like this project, please give it a star! ⭐**

[![GitHub stars](https://img.shields.io/github/stars/ROZ-MOFUMOFU-ME/zny-nomp.svg?style=social&label=Star)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp)
[![GitHub forks](https://img.shields.io/github/forks/ROZ-MOFUMOFU-ME/zny-nomp.svg?style=social&label=Fork)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp/fork)
[![GitHub watchers](https://img.shields.io/github/watchers/ROZ-MOFUMOFU-ME/zny-nomp.svg?style=social&label=Watch)](https://github.com/ROZ-MOFUMOFU-ME/zny-nomp)

Made with ❤️ by [ROZ](https://github.com/ROZ-MOFUMOFU-ME)

</div>

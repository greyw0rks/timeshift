# Lockpad · NEAR DeFi Resale

[Open Lockpad](https://greyw0rks.github.io/timeshift/)

Lockpad is a secondary marketplace for existing positions issued by other NEAR DeFi protocols. The public app shows position eligibility and currently has no verified external listings or enabled trade flow.

Shardpad documents creator fee reassignment. That right is separate from locked principal. The Rhea position NFT can move when its owner authorizes the transfer, subject to the rules of any locker that holds it. The first integration must verify the specific payout right, seller authority, transfer finality, and payment recovery on failure.

Run the public app with Node 22.12 or newer and `npm ci && npm run dev`.

The repository retains the original self-issued lock vault and its scripts as a testnet settlement prototype. Its testnet receipts demonstrate purchase and redemption of that vault's own claim.

## Rebuild and test

Use Rust 1.99.1 with `rust-src` and the Wasm target. Building the standard library for the Wasm MVP target avoids instructions that the NEAR runtime does not accept.

```sh
rustup target add wasm32-unknown-unknown
rustup component add rust-src
RUSTC_BOOTSTRAP=1 cargo build -Z build-std=std,panic_abort --locked --release --target wasm32-unknown-unknown
```

Use near-sandbox 2.14.1. On Linux x86-64:

```sh
mkdir -p target/sandbox
curl -fsSL https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.1/near-sandbox.tar.gz | tar -xz -C target/sandbox
NEAR_SANDBOX_BIN_PATH=1 NEAR_SANDBOX_BINARY_PATH="$PWD/target/sandbox/Linux-x86_64" npm test
```

For a fresh testnet deployment, set `TIMESHIFT_TESTNET_KEYS` to an absolute private directory outside the repository. Run `node scripts/deploy.mjs <unused-token.testnet> <unused-vault.testnet>`. The script creates and funds the accounts with the testnet helper, deploys the Wasm, initializes each account, and registers the vault with the token. An automated public-network run is also available in `scripts/testnet-demo.mjs`; pass the token, vault, seller and buyer account IDs in that order. Separate funded testnet signer accounts can be created with `scripts/create-testnet-account.mjs`.

## Hackathon scope

Discounted fixed-maturity instruments are established. Lockpad's narrower product idea is making a user's own fixed-term savings lock transferable, then demonstrating an early exit and maturity payout through one market. Savings discipline supplies a reason to lock. Without buyer demand, the owner waits to maturity.

The MVP supports one asset, fixed prices, and 1-minute, 7-day, 30-day and 90-day lock terms. The deployed accounts retain upgrade keys. The contracts are testnet prototypes and have not been audited. Before handling value, review upgrade control, callback failure recovery beyond ordinary FT transfer failures, storage pricing and the economics of listing liquidity.

# Lockpad · Tradable Locks

Lock 100 TUSD until a fixed date. If you need liquidity before maturity, list the Lock NFT for 92 TUSD. A buyer pays the asking price, the seller can withdraw 92 TUSD, and the buyer can redeem the 100 TUSD at maturity. The locked 100 stays in escrow throughout the sale.

Lockpad is a NEAR testnet MVP for the Unstoppable DeFi track. The other independent entry is [Greed Machine](https://github.com/greyw0rks/greed-machine). Lockpad has no AI features.

**Live testnet app** · [Open Lockpad](https://greyw0rks.github.io/timeshift/)

## Run the app

Use Node 22.12 or newer.

```sh
npm ci
npm run dev
```

The app defaults to the public NEAR testnet deployment. For a read-only walkthrough with sample listings, start with `VITE_PREVIEW=1 npm run dev`. To point at your own deployment, copy `.env.example` to `.env.local` and set both contract accounts. For static hosting, run `npm run build` and serve `dist/`.

| NEAR testnet contract | Account |
| --- | --- |
| Vault, marketplace and Lock NFT | [timeshift-vault-261113.testnet](https://testnet.nearblocks.io/address/timeshift-vault-261113.testnet) |
| NEP-141 demo token and faucet | [timeshift-tusd-261113.testnet](https://testnet.nearblocks.io/address/timeshift-tusd-261113.testnet) |

TUSD is a six-decimal test token with an uncapped faucet and no monetary value. Browser users need a funded testnet account for gas, FT registration and lock/listing storage.

## Two-wallet demo

1. Connect two testnet wallets using separate browser profiles. In each profile, open **My Locks** and click **Get test tokens**.
2. Wallet A creates a 100 TUSD lock using **1 minute (testnet demo)**, opens its Lock NFT from Portfolio and lists it for 92 TUSD.
3. Wallet B opens the same lock by URL or through the marketplace and buys before maturity. Show the purchase receipt and the new owner on the detail page.
4. Wallet A withdraws the 92 TUSD in My Locks. Once the countdown ends, Wallet B opens the lock and redeems 100 TUSD. Show the redemption receipt.
5. For a recording, rehearse the signing sequence and keep both browser profiles ready. The 60-second clock starts at the deposit receipt. Cut the recording between buy and redeem if needed.

An 8 TUSD discount is 8% of the locked payout and an 8.69% holding-period gain on a 92 TUSD purchase, rounded down by the UI. The buyer's gain comes from the price paid by the seller for early liquidity. An early sale requires a buyer.

## Public testnet proof

Lock #2 was created by `timeshift-seller-261113.testnet` and purchased and redeemed by `timeshift-buyer-261113.testnet`.

| Step | NEAR receipt |
| --- | --- |
| Deposit 100 TUSD and mint | [Create Lock #2](https://testnet.nearblocks.io/txns/EEKBtYADgXfYU3ndNUsi9sGP2ukzXFX11YEZAdfX873Z) |
| List for 92 TUSD | [List](https://testnet.nearblocks.io/txns/FEnAToX6pNKpBrtCczfHLpKQ7aTi37e6NzQ9pTavjs1J) |
| Reject and refund an underpayment | [Refund](https://testnet.nearblocks.io/txns/A775umJa37AeFL5zXUdeNSpzbFLH2VS6AA5QdSTxsrDA) |
| Purchase for 92 TUSD | [Buy](https://testnet.nearblocks.io/txns/2JNGFi7vb33CW4iSsB5UbbwXEkgGsABwC5BNkeHKoio4) |
| Seller withdraws 92 TUSD | [Withdraw](https://testnet.nearblocks.io/txns/25DHXxsU1hPv228riUw5hLvSmETTs2VWHMtcVYvDvEkJ) |
| Buyer redeems 100 TUSD | [Redeem](https://testnet.nearblocks.io/txns/jVBGmsSwrJHn3ncbcqi5vJcJ8rZoDcY1giqty2VHxNw) |

## Contract architecture

- A single Rust vault holds one allowlisted NEP-141 token, the NEP-171 ownership ledger and fixed-price listings. Minting occurs inside an authenticated `ft_on_transfer` callback. Lock amount and maturity are immutable.
- During a purchase callback the vault verifies the listing nonce, exact integer amount and maturity. It transfers NFT ownership, clears the listing and credits the seller in the same receipt. NEP-141 resolves rejected deposits or bids. Direct NFT transfers invalidate listings.
- Redemption puts the lock in `Paying` before scheduling the FT transfer. A private callback records the result. A failed transfer restores the lock to `Active`. A successful transfer leaves a consumed NFT receipt in the owner's portfolio. Seller withdrawals debit the available balance before dispatch and restore it on failure.
- Lock minting consumes a prepaid 0.03 testnet NEAR storage credit. Listing costs 0.03 testnet NEAR each time, including relisting. Those charges are fixed and retained for storage. No marketplace fee is taken from TUSD settlement. Direct token transfers to the vault outside `ft_transfer_call` create no lock or credit.
- The web app reads NEAR RPC and signs with NEAR Connect. Vite, React, Three.js and Motion render the interface without a separate application server. The Time Vault scene loads on demand and has a CSS fallback. The portfolio displays up to 100 positions and market sorting applies to the current page.

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

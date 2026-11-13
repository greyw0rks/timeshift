import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect, KeyPair, keyStores } from "near-api-js";

const [tokenId, vaultId, sellerId, buyerId] = process.argv.slice(2);
const directory = process.env.TIMESHIFT_TESTNET_KEYS;
if (!directory || !buyerId || ![tokenId, vaultId, sellerId, buyerId].every(id => id.endsWith(".testnet"))) {
  throw new Error("Pass token, vault, seller and buyer .testnet IDs and set TIMESHIFT_TESTNET_KEYS.");
}
const store = new keyStores.InMemoryKeyStore();
const rpc = process.env.VITE_NEAR_RPC || "https://test.rpc.fastnear.com";
const near = await connect({ networkId: "testnet", nodeUrl: rpc, keyStore: store });
const [seller, buyer] = await Promise.all([sellerId, buyerId].map(async (id) => {
  const credential = JSON.parse(await readFile(join(directory, id + ".json"), "utf8"));
  await store.setKey("testnet", id, KeyPair.fromString(credential.private_key));
  return near.account(id);
}));
const storage = 30_000_000_000_000_000_000_000n;
const call = async (account, contractId, methodName, args = {}, attachedDeposit = 1n) => {
  const outcome = await account.functionCall({ contractId, methodName, args, attachedDeposit, gas: 100_000_000_000_000n });
  console.log(`${methodName} https://testnet.nearblocks.io/txns/${outcome.transaction.hash}`);
  return {
    value: outcome.status.SuccessValue ? JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8")) : undefined,
    logs: outcome.receipts_outcome.flatMap(receipt => receipt.outcome.logs),
  };
};
const view = (contractId, methodName, args = {}) => seller.viewFunction({ contractId, methodName, args });
assert.equal(await view(vaultId, "asset"), tokenId);
const { min } = await view(tokenId, "storage_balance_bounds");
for (const user of [seller, buyer]) {
  if (!await view(tokenId, "storage_balance_of", { account_id: user.accountId })) {
    await call(user, tokenId, "storage_deposit", { registration_only: true }, BigInt(min));
  }
  await call(user, tokenId, "faucet", {}, 0n);
}
if (!await view(vaultId, "lock_credits", { owner: sellerId })) await call(seller, vaultId, "prepay_lock", {}, storage);
const send = (user, amount, msg) => call(user, tokenId, "ft_transfer_call", { receiver_id: vaultId, amount, msg: JSON.stringify(msg) });
const created = await send(seller, "100000000", { action: "lock", duration: 60 });
assert.equal(created.value, "100000000");
const mint = created.logs.find(log => log.includes('"event":"nft_mint"'));
const id = JSON.parse(mint.slice("EVENT_JSON:".length)).data[0].token_ids[0];
const position = () => view(vaultId, "get_lock", { id });
assert.equal((await position()).owner, sellerId);
await call(seller, vaultId, "list_lock", { id, price: "92000000" }, storage);
const offer = { action: "buy", id, nonce: (await position()).listing.nonce };
assert.equal((await send(buyer, "1", offer)).value, "0");
assert.equal((await send(buyer, "92000000", offer)).value, "92000000");
assert.equal((await position()).owner, buyerId);
assert.equal((await call(seller, vaultId, "withdraw_proceeds")).value, true);
const wait = Number(BigInt((await position()).lock.unlock_at) / 1000000n) - Date.now() + 3500;
if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
assert.equal((await call(buyer, vaultId, "redeem", { id })).value, true);
assert.equal((await position()).lock.status, "Redeemed");
console.log(`PASS: Lock #${id} settled on NEAR testnet.`);

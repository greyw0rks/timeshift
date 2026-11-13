import assert from "node:assert/strict";
import { Worker } from "near-workspaces";

const worker = await Worker.init();
const directory = process.env.WASM_DIR || "target/wasm32-unknown-unknown/release";
const yocto = "1";
const storage = "30000000000000000000000";
const deposit = "1250000000000000000000";
const value = "100000000";
const price = "92000000";
const gas = "100000000000000";

try {
  const root = worker.rootAccount;
  const token = await root.createSubAccount("token");
  const vault = await root.createSubAccount("vault");
  const seller = await root.createSubAccount("seller");
  const buyer = await root.createSubAccount("buyer");
  await Promise.all([
    token.deploy(directory + "/timeshift_token.wasm"),
    vault.deploy(directory + "/timeshift_contract.wasm"),
  ]);
  await token.call(token, "new", {});
  await vault.call(vault, "new", { asset: token.accountId });
  for (const account of [vault, seller, buyer]) {
    await account.call(token, "storage_deposit", { registration_only: true }, { attachedDeposit: deposit });
    if (account !== vault) await account.call(token, "faucet", {});
  }

  const balance = account => token.view("ft_balance_of", { account_id: account.accountId });
  const position = () => vault.view("get_lock", { id: "1" });
  const send = (account, amount, message) => account.call(token, "ft_transfer_call", {
    receiver_id: vault.accountId, amount, msg: JSON.stringify(message),
  }, { attachedDeposit: yocto, gas });
  await seller.call(vault, "prepay_lock", {}, { attachedDeposit: storage });
  assert.equal(await send(seller, value, { action: "lock", duration: 60 }), value);
  assert.equal((await position()).owner, seller.accountId);
  await assert.rejects(seller.call(vault, "redeem", { id: "1" }, { attachedDeposit: yocto, gas }));
  await assert.rejects(buyer.call(vault, "list_lock", { id: "1", price }, { attachedDeposit: storage }));
  await seller.call(vault, "list_lock", { id: "1", price }, { attachedDeposit: storage });
  const offer = { action: "buy", id: "1", nonce: (await position()).listing.nonce };
  assert.equal(await send(buyer, "1", offer), "0");
  assert.equal(await balance(buyer), "1000000000");
  assert.equal(await send(buyer, price, offer), price);
  assert.equal((await position()).owner, buyer.accountId);
  assert.equal((await position()).listing, null);
  assert.equal(await balance(vault), "192000000");
  assert.equal(await send(buyer, price, offer), "0");
  assert.equal(await balance(buyer), "908000000");

  // An unregistered recipient forces the transfer receipt to fail and exercises restoration.
  await seller.call(token, "storage_unregister", { force: true }, { attachedDeposit: yocto });
  assert.equal(await seller.call(vault, "withdraw_proceeds", {}, { attachedDeposit: yocto, gas }), false);
  assert.equal(await vault.view("proceeds_of", { owner: seller.accountId }), price);
  await seller.call(token, "storage_deposit", { registration_only: true }, { attachedDeposit: deposit });
  assert.equal(await seller.call(vault, "withdraw_proceeds", {}, { attachedDeposit: yocto, gas }), true);
  assert.equal(await balance(seller), price);
  assert.equal(await balance(vault), value);

  await seller.call(vault, "prepay_lock", {}, { attachedDeposit: storage });
  assert.equal(await send(seller, "10000000", { action: "lock", duration: 604800 }), "10000000");
  await seller.call(vault, "list_lock", { id: "2", price: "9000000" }, { attachedDeposit: storage });
  const stale = await vault.view("get_lock", { id: "2" });
  await seller.call(vault, "nft_transfer", { receiver_id: buyer.accountId, token_id: "2" }, { attachedDeposit: yocto });
  assert.equal((await vault.view("get_lock", { id: "2" })).listing, null);
  assert.equal(await send(buyer, "9000000", { action: "buy", id: "2", nonce: stale.listing.nonce }), "0");

  const wait = Math.max(0, Number(BigInt((await position()).lock.unlock_at) / 1000000n) - Date.now() + 2500);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  await assert.rejects(seller.call(vault, "redeem", { id: "1" }, { attachedDeposit: yocto, gas }));
  await buyer.call(token, "storage_unregister", { force: true }, { attachedDeposit: yocto });
  assert.equal(await buyer.call(vault, "redeem", { id: "1" }, { attachedDeposit: yocto, gas }), false);
  assert.equal((await position()).lock.status, "Active");
  await buyer.call(token, "storage_deposit", { registration_only: true }, { attachedDeposit: deposit });
  assert.equal(await buyer.call(vault, "redeem", { id: "1" }, { attachedDeposit: yocto, gas }), true);
  assert.equal((await position()).lock.status, "Redeemed");
  await assert.rejects(buyer.call(vault, "redeem", { id: "1" }, { attachedDeposit: yocto, gas }));
  assert.equal(await balance(buyer), value);
  assert.equal(await balance(vault), "10000000");
  console.log("PASS: escrow, ownership, refunds, seller withdrawal recovery, and maturity redemption");
} finally {
  await worker.tearDown();
}

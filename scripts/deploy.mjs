import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KeyPair, connect, keyStores, transactions as nearTransactions } from "near-api-js";

const directory = process.env.WASM_DIR || "target/wasm32-unknown-unknown/release";
const credentials = process.env.TIMESHIFT_TESTNET_KEYS;
if (!credentials) throw new Error("Set TIMESHIFT_TESTNET_KEYS to a private directory outside the repository.");
const accounts = process.argv.slice(2);
if (accounts.length !== 2 || accounts.some(id => !/^[a-z0-9-]+\.testnet$/.test(id)) || accounts[0] === accounts[1]) {
  throw new Error("Pass two distinct top-level .testnet accounts: token then vault.");
}
const names = ["token", "contract"];
const keyStore = new keyStores.InMemoryKeyStore();
const rpc = process.env.VITE_NEAR_RPC || "https://test.rpc.fastnear.com";
const near = await connect({ networkId: "testnet", nodeUrl: rpc, keyStore });
await mkdir(credentials, { recursive: true, mode: 0o700 });
const deployed = [];
for (const [index, accountId] of accounts.entries()) {
  const path = join(credentials, accountId + ".json");
  let key;
  try { key = KeyPair.fromString(JSON.parse(await readFile(path, "utf8")).private_key); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    key = KeyPair.fromRandom("ed25519");
    const publicKey = key.getPublicKey().toString();
    await writeFile(path, JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: key.toString() }), { mode: 0o600, flag: "wx" });
  }
  await keyStore.setKey("testnet", accountId, key);
  const account = await near.account(accountId);
  let state;
  try { state = await account.state(); }
  catch (error) {
    if (error.type !== "AccountDoesNotExist") throw error;
    const response = await fetch("https://helper.testnet.near.org/account", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
    });
    if (!response.ok) throw new Error(`Testnet account faucet returned HTTP ${response.status} for ${accountId}.`);
    for (let attempt = 0; attempt < 15 && !state; attempt++) {
      try { state = await account.state(); }
      catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    if (!state) throw new Error("New account has not appeared on testnet yet.");
  }
  if (state.code_hash !== "11111111111111111111111111111111") {
    throw new Error(`${accountId} already has code. Use fresh accounts or complete the interrupted deployment manually.`);
  }
  const contract = await readFile(join(directory, `timeshift_${names[index]}.wasm`));
  const args = index === 0 ? {} : { asset: accounts[0] };
  const outcome = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: [nearTransactions.deployContract(contract), nearTransactions.functionCall("new", args, 50_000_000_000_000n, 0n)],
  });
  console.log(`Deployed ${accountId} in ${outcome.transaction.hash}`);
  deployed.push(account);
}
const [token, vault] = deployed;
const bounds = await token.viewFunction({ contractId: token.accountId, methodName: "storage_balance_bounds", args: {} });
await vault.functionCall({
  contractId: token.accountId, methodName: "storage_deposit",
  args: { registration_only: true }, attachedDeposit: BigInt(bounds.min),
});
console.log(`VITE_TOKEN_ACCOUNT=${token.accountId}\nVITE_VAULT_ACCOUNT=${vault.accountId}`);


import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KeyPair } from "near-api-js";

const directory = process.env.TIMESHIFT_TESTNET_KEYS;
const accountId = process.argv[2];
if (!directory || !/^[a-z0-9-]+\.testnet$/.test(accountId || "")) {
  throw new Error("Set TIMESHIFT_TESTNET_KEYS and pass an unused top-level .testnet account.");
}
const key = KeyPair.fromRandom("ed25519");
await mkdir(directory, { recursive: true, mode: 0o700 });
const publicKey = key.getPublicKey().toString();
await writeFile(join(directory, accountId + ".json"), JSON.stringify({
  account_id: accountId, public_key: publicKey, private_key: key.toString(),
}), { mode: 0o600, flag: "wx" });
const result = await fetch("https://helper.testnet.near.org/account", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
});
if (!result.ok) throw new Error(`Account faucet returned HTTP ${result.status}`);
console.log(`Created ${accountId}`);

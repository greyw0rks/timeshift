export const vault = import.meta.env.VITE_VAULT_ACCOUNT || "timeshift-vault-261113.testnet";
export const asset = import.meta.env.VITE_TOKEN_ACCOUNT || "timeshift-tusd-261113.testnet";
export const configured = import.meta.env.VITE_PREVIEW !== "1";
const rpc = import.meta.env.VITE_NEAR_RPC || "https://test.rpc.fastnear.com";
export const one = "1";
export const storage = "30000000000000000000000";

export async function confirmedOutcome(hash, sender_account_id) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx",
      params: { tx_hash: hash, sender_account_id, wait_until: "FINAL" } }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.result) throw new Error("Receipt could not be confirmed. Check the explorer before retrying.");
  return payload.result;
}

export async function view(account, method_name, args = {}) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: account,
        method_name, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  if (!response.ok) throw new Error("NEAR RPC unavailable");
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.cause?.info?.error_message || payload.error.message);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(payload.result.result)));
}

export function call(methodName, args = {}, deposit = one) {
  return { type: "FunctionCall", params: { methodName, args, gas: "100000000000000", deposit } };
}

export function funding(amount, message) {
  return call("ft_transfer_call", { receiver_id: vault, amount, msg: JSON.stringify(message) });
}

export function units(value) {
  if (!/^\d{1,20}(\.\d{1,6})?$/.test(value)) throw new Error("Enter a positive amount with up to six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("Enter a positive amount.");
  return amount.toString();
}

export function format(value) {
  const amount = BigInt(value);
  const fraction = String(amount % 1000000n).padStart(6, "0").replace(/0+$/, "");
  return (amount / 1000000n).toLocaleString("en-US") + (fraction ? "." + fraction : "");
}

export function outcomeError(outcome, action) {
  if (!outcome || typeof outcome.status !== "object") throw new Error("The wallet did not confirm execution. Check your receipt before retrying.");
  if (outcome.status.Failure) throw new Error("Transaction failed. Open the receipt for details.");
  if ("SuccessValue" in outcome.status) {
    const value = atob(outcome.status.SuccessValue);
    if (value === "false") throw new Error("Token payout failed. Register your token account and retry.");
    const expected = action.params.methodName === "ft_transfer_call" ? action.params.args.amount : null;
    if (expected && value !== JSON.stringify(expected)) throw new Error("The contract returned the token payment. Refresh the lock and review the receipt.");
  }
}

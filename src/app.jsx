import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { asset, call, configured, confirmedOutcome, format, funding, one, outcomeError, storage, units, vault, view } from "./near";
import "./style.css";

const VaultScene = lazy(() => import("./vault-scene"));
const DAY = 86400000;
const demoNow = Date.now();
const preview = [1000, 2500, 500].map((amount, index) => ({
  id: String(42 + index), owner: ["atlas.testnet", "kepler.testnet", "nova.testnet"][index],
  lock: { amount: String(amount * 1000000), status: "Active", unlock_at: String(BigInt(demoNow + [30, 60, 7][index] * DAY) * 1000000n) },
  listing: { price: String([920, 2375, 485][index] * 1000000) },
}));
const routes = [["/", "Home"], ["/marketplace", "Marketplace"], ["/lock", "Create lock"], ["/portfolio", "Portfolio"]];
const unlockTime = ({ lock }) => Number(BigInt(lock.unlock_at) / 1000000n);
const durationLabel = (ms) => ms <= 0 ? "Matured" : ms >= DAY ? Math.ceil(ms / DAY) + " days" : Math.ceil(ms / 1000) + " sec";
const discount = (amount, price) => (Number((BigInt(amount) - BigInt(price)) * 10000n / BigInt(amount)) / 100).toFixed(2);
let connectorPromise;
function connector() {
  connectorPromise ??= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "testnet" }));
  return connectorPromise;
}

function App() {
  const reduced = useReducedMotion();
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [now, setNow] = useState(Date.now);
  const [account, setAccount] = useState("");
  const [version, refresh] = useState(0);
  const [market, setMarket] = useState({ items: configured ? [] : preview });
  const [portfolio, setPortfolio] = useState({ items: [], proceeds: "0", balance: "0" });
  const [detail, setDetail] = useState(null);
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState("All");
  const [sort, setSort] = useState("maturity");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState(60);
  const detailId = route.match(/^\/lock\/(\d+)$/)?.[1];

  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || "/"); window.scrollTo(0, 0); };
    const timer = setInterval(() => setNow(Date.now()), 1000);
    addEventListener("hashchange", change);
    return () => { clearInterval(timer); removeEventListener("hashchange", change); };
  }, []);

  useEffect(() => {
    if (!configured) return;
    let closed = false;
    let instance;
    const signedIn = ({ accounts }) => setAccount(accounts[0]?.accountId || "");
    const signedOut = () => setAccount("");
    connector().then(async (current) => {
      if (closed) return;
      instance = current;
      current.on("wallet:signIn", signedIn);
      current.on("wallet:signOut", signedOut);
      const wallet = await current.wallet();
      const accounts = await wallet?.getAccounts({ network: "testnet" });
      if (!closed && accounts?.length) signedIn({ accounts });
    }).catch(() => {});
    return () => {
      closed = true;
      instance?.off?.("wallet:signIn", signedIn);
      instance?.off?.("wallet:signOut", signedOut);
    };
  }, []);

  useEffect(() => {
    if (!configured) return;
    let closed = false;
    const query = async () => {
      try {
        const actual = await view(vault, "asset");
        if (actual !== asset) throw new Error("Configured token differs from the vault's allowlisted token.");
        const items = await view(vault, "get_listings", { from_index: offset, limit: 13 });
        if (!closed) setMarket({ items, verified: true });
      } catch (error) { if (!closed) setMarket({ items: [], error: error.message }); }
    };
    query();
    return () => { closed = true; };
  }, [version, offset]);

  useEffect(() => {
    if (!account) return;
    let closed = false;
    Promise.all([
      view(vault, "get_locks_by_owner", { owner: account, from_index: "0", limit: 100 }),
      view(vault, "proceeds_of", { owner: account }),
      view(asset, "ft_balance_of", { account_id: account }),
    ]).then(([items, proceeds, balance]) => {
      if (!closed) setPortfolio({ items, proceeds, balance, owner: account });
    }).catch((error) => { if (!closed) setPortfolio({ items: [], proceeds: "0", balance: "0", owner: account, error: error.message }); });
    return () => { closed = true; };
  }, [version, account]);

  useEffect(() => {
    if (!detailId) return;
    let closed = false;
    setDetail(null);
    const lookup = configured ? view(vault, "get_lock", { id: detailId }) : Promise.resolve(preview.find(item => item.id === detailId));
    lookup.then(item => { if (!closed) setDetail({ item, id: detailId }); })
      .catch(error => { if (!closed) setDetail({ error: error.message, id: detailId }); });
    return () => { closed = true; };
  }, [detailId, version]);

  const connect = async () => {
    try { await (await connector()).connect(); }
    catch (error) { setNotice({ type: "error", message: error.message }); }
  };

  async function transact(label, execute) {
    if (busy || !account || !market.verified) return;
    setBusy(true);
    let receipt;
    setNotice({ message: "Waiting for wallet approval…" });
    try {
      const wallet = await (await connector()).wallet();
      await execute(async (receiverId, action) => {
        const result = await wallet.signAndSendTransaction({ signerId: account, receiverId, actions: [action] });
        const hash = result?.transaction?.hash || result?.transaction_outcome?.id;
        if (hash) receipt = "https://testnet.nearblocks.io/txns/" + encodeURIComponent(hash);
        if (!result) throw new Error("Wallet returned without a receipt. Check wallet activity before retrying.");
        outcomeError(typeof result.status === "object" ? result : hash ? await confirmedOutcome(hash, account) : result, action);
      });
      setNotice({ type: "success", message: label, receipt });
      setConfirm(null);
    } catch (error) {
      setNotice({ type: "error", message: error.message, receipt });
    } finally {
      refresh(n => n + 1);
      setBusy(false);
    }
  }

  async function register(send) {
    const existing = await view(asset, "storage_balance_of", { account_id: account });
    if (!existing) {
      const { min } = await view(asset, "storage_balance_bounds");
      await send(asset, call("storage_deposit", { account_id: account, registration_only: true }, min));
    }
  }

  function create(event) {
    event.preventDefault();
    try {
      const deposit = units(amount);
      if (BigInt(deposit) > BigInt(owns.balance)) throw new Error("Insufficient TUSD. Use the test token faucet in Portfolio.");
      transact("Lock created. Find your Lock NFT in Portfolio.", async (send) => {
        const credits = await view(vault, "lock_credits", { owner: account });
        if (!credits) await send(vault, call("prepay_lock", {}, storage));
        await send(asset, funding(deposit, { action: "lock", duration }));
        setAmount("");
      });
    } catch (error) { setNotice({ type: "error", message: error.message }); }
  }

  const accountReady = Boolean(account && configured && market.verified && !busy);
  const active = market.items.slice(0, 12).filter(item => unlockTime(item) > now);
  const sorted = [...active].sort((a, b) => sort === "discount"
    ? Number(discount(b.lock.amount, b.listing.price)) - Number(discount(a.lock.amount, a.listing.price))
    : unlockTime(a) - unlockTime(b));
  const owns = portfolio.owner === account ? portfolio : { items: [], balance: "0", proceeds: "0" };

  function card(item, marketplace = false) {
    const { lock, listing, id } = item;
    return <motion.a layout={!reduced} whileHover={reduced ? undefined : { y: -4 }} className="position" key={id} href={"#/lock/" + id}>
      <div className="row"><span className="lock-icon">◈</span><span className="chip">{lock.status === "Active" ? durationLabel(unlockTime(item) - now) : lock.status}</span></div>
      <span className="muted mono">LOCK #{id}</span>
      <strong>{format(lock.amount)} <small>TUSD</small></strong>
      <div className="row card-foot">
        <span>{listing ? <><span className="muted">{marketplace ? "Buy for " : "Listed at "}</span>{format(listing.price)} TUSD</> : <span className="muted">View position</span>}</span>
        {listing && <span className="amber">{discount(lock.amount, listing.price)}% off</span>}
      </div>
    </motion.a>;
  }

  function detailControls(item) {
    const { id, lock, owner, listing } = item;
    const mature = unlockTime(item) <= now;
    if (lock.status !== "Active") return <p>{lock.status === "Paying" ? "Redemption is settling." : "This lock has been redeemed."}</p>;
    if (owner !== account) {
      if (!listing || mature) return <p className="muted">This lock is unavailable for purchase.</p>;
      const profit = BigInt(lock.amount) - BigInt(listing.price);
      const roi = (Number(profit * 10000n / BigInt(listing.price)) / 100).toFixed(2);
      return <><div className="facts"><div><span>Purchase price</span><strong>{format(listing.price)} TUSD</strong></div>
        <div><span>Gross return at maturity</span><strong>{format(profit)} TUSD · {roi}%</strong></div></div>
        <button className="primary" disabled={!accountReady} onClick={() => setConfirm({ item })}>Buy lock</button></>;
    }
    return <div className="controls">
      {mature ? <button className="primary" disabled={!accountReady} onClick={() => transact("Funds redeemed.", async send => {
        await register(send); await send(vault, call("redeem", { id }));
      })}>Redeem {format(lock.amount)} TUSD</button> :
        listing ? <button disabled={!accountReady} onClick={() => transact("Listing canceled.", send => send(vault, call("cancel_listing", { id })))}>Cancel listing</button>
        : <form onSubmit={event => {
          event.preventDefault();
          try {
            const price = units(new FormData(event.target).get("price"));
            if (BigInt(price) >= BigInt(lock.amount)) throw new Error("Ask for less than the locked payout.");
            transact("Lock listed.", send => send(vault, call("list_lock", { id, price }, storage)));
          } catch (error) { setNotice({ type: "error", message: error.message }); }
        }}><label>Sale price (TUSD)<input name="price" inputMode="decimal" required /></label>
          <button className="primary" disabled={!accountReady}>List lock</button><small className="muted">0.03 testnet NEAR storage charge</small></form>}
      <form onSubmit={event => {
        event.preventDefault();
        const receiver_id = String(new FormData(event.target).get("recipient")).trim();
        transact("Lock transferred.", send => send(vault, call("nft_transfer", { token_id: id, receiver_id }, one)));
      }}><label>Transfer to a NEAR account<input name="recipient" placeholder="account.testnet" required /></label>
        <button disabled={!accountReady}>Transfer lock</button>{listing && <small className="muted">Transferring cancels the listing.</small>}</form>
    </div>;
  }

  return <div className="shell">
    <header><a className="wordmark" href="#/"><span>◈</span> Lockpad</a>
      <nav aria-label="Main navigation">{routes.map(([href, label]) => <a key={href} href={"#" + href} aria-current={route === href ? "page" : undefined}>{label}</a>)}</nav>
      {configured ? account ? <button className="wallet" onClick={async () => {
        try { await (await connector()).disconnect(); setAccount(""); }
        catch (error) { setNotice({ type: "error", message: error.message }); }
      }} title="Disconnect wallet">{account}</button> : <button className="wallet" onClick={connect}>Connect wallet</button> : <span className="chip network">Preview mode</span>}
    </header>
    <main>
      {market.error && <p className="banner error" role="alert">{market.error}</p>}
      {notice && <motion.aside initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={"toast " + (notice.type || "")} role="status">
        <span>{notice.message}</span>{notice.receipt && <a href={notice.receipt} target="_blank" rel="noreferrer">Receipt ↗</a>}<button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
      </motion.aside>}
      <motion.div key={route} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
      {route === "/" && <div className="landing">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow"><i /> BUILT ON NEAR TESTNET</p>
            <h1 id="hero-heading">Sell the lock.<br /><em>Keep the funds locked.</em></h1>
            <p>Turn a fixed-term savings lock into something you can sell. A buyer pays you today and redeems the funds when the lock matures.</p>
            <div className="actions"><a className="button primary" href="#/marketplace">Explore marketplace <span aria-hidden="true">↗</span></a><a className="button" href="#/lock">Create a lock</a></div>
          </div>
          <div className="art">
            <div className="art-grid" />
            <div className="fallback" aria-hidden="true" />
            <Suspense fallback={null}><VaultScene reduced={reduced} /></Suspense>
            <span className="art-label">THE TIME VAULT</span>
            <div className="art-caption"><span>ESCROWED PAYOUT</span><strong>100 TUSD</strong></div>
          </div>
        </section>
        <section className="how" aria-labelledby="how-heading">
          <div className="section-head"><h2 id="how-heading">How it works</h2><span className="mono muted">Example trade · TUSD</span></div>
          <div className="steps">
            <article><h3>Lock</h3><strong>100 <small>TUSD</small></strong><p>Deposit funds and choose when they unlock. Your Lock NFT gives you the right to redeem them.</p></article>
            <article><h3>Sell</h3><strong>92 <small>TUSD</small></strong><p>Set an asking price. When someone buys, you can withdraw the sale proceeds.</p></article>
            <article><h3>Redeem</h3><strong>100 <small>TUSD</small></strong><p>At maturity, the current owner redeems the full amount from escrow.</p></article>
          </div>
        </section>
        <section className="proof" aria-labelledby="proof-heading">
          <div><h2 id="proof-heading">See a settled lock</h2><p>Two testnet wallets completed this trade. Open the lock to see its final owner and redemption status.</p></div>
          <a className="button" href={configured && vault === "timeshift-vault-261113.testnet" ? "#/lock/2" : "https://testnet.nearblocks.io/txns/jVBGmsSwrJHn3ncbcqi5vJcJ8rZoDcY1giqty2VHxNw"}>View Lock #2 <span aria-hidden="true">↗</span></a>
        </section>
      </div>}
      {route === "/marketplace" && <section><div className="section-head"><h1 className="title">Marketplace</h1>
        <label className="sort">Sort by <select value={sort} onChange={event => setSort(event.target.value)}><option value="maturity">Soonest maturity</option><option value="discount">Largest discount</option></select></label></div>
        <p className="muted">{configured ? "Buy a lock and redeem the full payout at maturity." : "Sample listings for preview. Connect a testnet deployment to trade."}</p>
        <div className="cards">{sorted.map(item => card(item, true))}</div>
        {!sorted.length && <p className="empty">No available locks on this page.</p>}
        {configured && <div className="actions"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 12))}>Previous</button><button disabled={market.items.length < 13} onClick={() => setOffset(offset + 12)}>Next</button></div>}
      </section>}
      {route === "/lock" && <section className="narrow"><p className="eyebrow">CREATE POSITION</p><h1 className="title">Create a lock</h1>
        <p className="muted">Choose an amount and a duration. The funds stay in escrow until the unlock date. You can sell the NFT before then.</p>
        <form className="panel" onSubmit={create}>
          <label>Amount (TUSD)<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" required /></label>
          <small className="muted">Wallet balance {format(owns.balance)} TUSD</small>
          <label>Lock duration<select value={duration} onChange={event => setDuration(Number(event.target.value))}>
            <option value={60}>1 minute (testnet demo)</option><option value={604800}>7 days</option><option value={2592000}>30 days</option><option value={7776000}>90 days</option>
          </select></label>
          <small className="muted">Estimated unlock {new Date(now + duration * 1000).toLocaleString()} · 0.03 testnet NEAR storage per lock</small>
          <button className="primary" disabled={!accountReady}>Lock funds</button>
        </form>
      </section>}
      {route === "/portfolio" && <section><p className="eyebrow">YOUR POSITIONS</p><h1 className="title">Portfolio</h1>
        {owns.error && <p className="banner error" role="alert">{owns.error}</p>}
        {!account ? <p className="empty">{configured ? "Connect a testnet wallet to view your locks." : "Configure a testnet deployment to connect a wallet."}</p> : <>
          <div className="facts"><div><span>Wallet balance</span><strong>{format(owns.balance)} TUSD</strong><button disabled={!accountReady} onClick={() => transact("Test tokens received.", async send => { await register(send); await send(asset, call("faucet", {}, "0")); })}>Get test tokens</button></div>
          <div><span>Sale proceeds</span><strong>{format(owns.proceeds)} TUSD</strong><button disabled={!accountReady || owns.proceeds === "0"} onClick={() => transact("Sale proceeds withdrawn.", async send => { await register(send); await send(vault, call("withdraw_proceeds")); })}>Withdraw proceeds</button></div></div>
          <div className="tabs">{["All", "Listed", "Matured", "Redeemed"].map(label => <button aria-pressed={tab === label} key={label} onClick={() => setTab(label)}>{label}</button>)}</div>
          <div className="cards">{owns.items.filter(item => tab === "All" || tab === "Listed" && item.listing && unlockTime(item) > now || tab === "Matured" && item.lock.status === "Active" && unlockTime(item) <= now || tab === "Redeemed" && item.lock.status === "Redeemed").map(item => card(item))}</div>
        </>}
      </section>}
      {detailId && <section className="narrow"><a href="#/marketplace">← Marketplace</a>
        {detail?.id !== detailId ? <p className="empty">Loading lock…</p> : detail.item ? <>
          <p className="eyebrow detail-eyebrow">LOCK #{detailId}</p><h1 className="title">{format(detail.item.lock.amount)} TUSD</h1>
          <div className="panel"><div className="row"><span className="muted">Current owner</span><span className="mono owner">{detail.item.owner}</span></div>
          <div className="row"><span className="muted">Unlocks</span><span>{new Date(unlockTime(detail.item)).toLocaleString()}</span></div>
          <div className="row"><span className="muted">Time remaining</span><span className="amber">{durationLabel(unlockTime(detail.item) - now)}</span></div>
          {detailControls(detail.item)}</div></> : <p className="empty">{detail.error || "Lock does not exist."}</p>}
      </section>}
      </motion.div>
    </main>
    <footer><span>Lockpad</span><span>NEAR testnet · TUSD has no monetary value</span></footer>
    <AnimatePresence>{confirm && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overlay">
      <section className="panel modal" role="dialog" aria-modal="true" aria-labelledby="buy-heading" onKeyDown={event => { if (event.key === "Escape" && !busy) setConfirm(null); }}>
        <h2 id="buy-heading">Buy Lock #{confirm.item.id}?</h2>
        <p>Pay {format(confirm.item.listing.price)} TUSD. At maturity you can redeem {format(confirm.item.lock.amount)} TUSD.</p>
        <div className="actions"><button autoFocus disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          <button className="primary" disabled={!accountReady} onClick={() => {
            const { id, listing } = confirm.item;
            transact("Lock purchased. You are the new owner.", send => send(asset, funding(listing.price, { action: "buy", id, nonce: listing.nonce })));
          }}>Confirm purchase</button></div>
      </section>
    </motion.div>}</AnimatePresence>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);

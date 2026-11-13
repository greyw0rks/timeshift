import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion, useReducedMotion } from "motion/react";
import "./style.css";

const VaultScene = lazy(() => import("./vault-scene"));
const protocols = [
  { name: "Shardpad", asset: "Creator fee rights", status: "Under review", detail: "Creators can reassign their fee share. Sale settlement and treatment of accrued fees still need verification.", url: "https://shardpad.com/docs" },
  { name: "Shardpad", asset: "Locked liquidity principal", status: "Admin transfer only", detail: "The locker admin can move the position. Creators have no documented right to transfer the locked principal.", url: "https://shardpad.com/docs" },
  { name: "Rhea Finance", asset: "Locker-held concentrated liquidity", status: "Locker-dependent", detail: "A position NFT can be transferred by its owner. Once a locker owns it, the locker determines who can transfer it.", url: "https://github.com/ref-finance/guide/blob/main/developers/contracts.md" },
  { name: "House of Stake", asset: "veNEAR", status: "Non-transferable", detail: "Delegation grants voting power. veNEAR itself cannot be traded.", url: "https://docs.houseofstake.org/docs/governance-system/what-is-venear" },
];

function Protocols() {
  return <section aria-labelledby="protocols">
    <div className="section-head"><h2 id="protocols">Position eligibility</h2></div>
    <div className="cards protocol-cards">{protocols.map(({ name, asset, status, detail, url }) =>
      <article className="position" key={asset}>
        <div className="row"><span className="muted">{name}</span><span className="chip">{status}</span></div>
        <h3>{asset}</h3><p>{detail}</p><a href={url} target="_blank" rel="noreferrer">Protocol documentation ↗</a>
      </article>)}</div>
  </section>;
}

function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "/");
  const reduced = useReducedMotion();
  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || "/"); window.scrollTo(0, 0); };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const list = route === "/list";
  const home = route === "/";
  return <div className={"shell" + (home ? " home" : "")}>
    <header>
      <a className="wordmark" href="#/"><span aria-hidden="true">◈</span> lockpad.</a>
      <nav aria-label="Main navigation">
        <a href="#/marketplace" aria-current={route === "/marketplace" ? "page" : undefined}>Explore</a>
      </nav>
      <a className="button list-action" href="#/list">List position</a>
    </header>
    <main>
      <motion.div key={route} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {home ? <section className="hero" aria-labelledby="headline">
          <div className="hero-copy">
            <p className="eyebrow"><i /> NEAR DEFI RESALE</p>
            <h1 id="headline">Sell your <em>locked position.</em></h1>
            <p>Lockpad is a secondary marketplace for positions you already hold on other NEAR DeFi platforms. A sale requires the originating protocol to let the buyer take over the payout right.</p>
            <div className="actions"><a className="button primary" href="#/marketplace">Explore positions ↗</a></div>
          </div>
          <div className="art"><div className="art-grid" /><div className="fallback" aria-hidden="true" />
            <Suspense fallback={null}><VaultScene reduced={reduced} /></Suspense>
          </div>
        </section> : <section className="deals">
          <h1 className="title">{list ? "List an existing position" : "Explore positions"}</h1>
          <p className="empty">{list ? "Listing opens once an external protocol integration can verify ownership and transfer the payout right." : "No external positions are available to buy yet. See the eligibility review below."}</p>
        </section>}
        <Protocols />
      </motion.div>
    </main>
    <footer><span>Lockpad</span><span>NEAR DeFi position eligibility</span></footer>
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);

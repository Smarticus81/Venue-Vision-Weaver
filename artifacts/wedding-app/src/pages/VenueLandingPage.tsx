import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { Play, Pause, Check, Plus, Eye, MousePointer2, Share2 } from "lucide-react";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { formatMoney, usePublicConfig } from "@/lib/publicConfig";
import { track, trackOnce } from "@/lib/track";
import { useIsOperator } from "@/lib/operatorAccess";

// Enable only after the generated output passes visual QA.
const VENUE_FILM: string = "";
const exterior = "/brand/khp-exterior-1920.webp";
const interior = "/brand/khp-entryway-1536.webp";
const preview = "/brand/khp-couple-1536.webp";
const dusk = "/brand/khp-dusk-1536.webp";

function StartLink({ placement, children = "Start free" }: { placement: string; children?: React.ReactNode }) {
  return <Link href="/create-venue" className="cinema-button" onClick={() => track("cta_click", { placement })}>{children}</Link>;
}

function VenueFilm() {
  const [scene, setScene] = useState<"dusk" | "original">("dusk");
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const manuallyPaused = useRef(false);
  useEffect(() => {
    const player = video.current;
    if (!player || !VENUE_FILM) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && !preference.matches && !connection?.saveData && !manuallyPaused.current) void player.play().catch(() => setPlaying(false));
      else player.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .15 });
    observer.observe(player);
    document.addEventListener("visibilitychange", sync);
    preference.addEventListener("change", sync);
    return () => { observer.disconnect(); player.pause(); document.removeEventListener("visibilitychange", sync); preference.removeEventListener("change", sync); };
  }, []);
  async function toggle() {
    if (!video.current) return;
    if (playing) { manuallyPaused.current = true; video.current.pause(); }
    else { manuallyPaused.current = false; try { await video.current.play(); } catch { setFailed(true); } }
  }
  return <>
    <picture key={scene} className="cinema-hero__media"><source media="(max-width: 760px)" srcSet={scene === "dusk" ? "/brand/khp-dusk-800.webp" : "/brand/khp-exterior-800.webp"}/><img src={scene === "dusk" ? dusk : exterior} width="1536" height="1024" alt={scene === "dusk" ? "Dusk lighting visualization of Knotting Hill Place, with amber-lit stone and a violet evening sky" : "Original daylight photograph of Knotting Hill Place"} fetchPriority="high"/></picture>
    <div className="cinema-scenes"><p>Explore the venue</p><div role="group" aria-label="Choose venue scene"><button type="button" aria-pressed={scene === "dusk"} onClick={() => setScene("dusk")}><img src="/brand/khp-dusk-800.webp" alt="" width="96" height="64"/><span>Dusk</span></button><button type="button" aria-pressed={scene === "original"} onClick={() => setScene("original")}><img src="/brand/khp-exterior-800.webp" alt="" width="96" height="64"/><span>Original</span></button></div><small aria-live="polite">{scene === "dusk" ? "Lighting visualization · not an event photograph" : "Original photograph · White Orchid Photography"}</small></div>
    {VENUE_FILM && <video ref={video} className="cinema-hero__media" muted playsInline loop preload="none" poster={exterior} aria-label="Generated architectural film based on a photograph of Knotting Hill Place" onPlay={() => { setPlaying(true); setFailed(false); }} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setFailed(true); }}><source src={VENUE_FILM} type="video/mp4"/></video>}
    {VENUE_FILM && <div className="cinema-film-control"><button type="button" onClick={() => void toggle()} aria-label={playing ? "Pause venue film" : "Play venue film"}>{playing ? <Pause size={18}/> : <Play size={18}/>}<span>{playing ? "Pause film" : "Play film"}</span></button>{failed && <a href={VENUE_FILM} target="_blank" rel="noopener noreferrer">Open video</a>}</div>}
  </>;
}

function PhotoDemo() {
  const [split, setSplit] = useState(48);
  return <section className="cinema-demo" id="experience" aria-labelledby="demo-heading">
    <div className="cinema-section-heading"><div><p className="cinema-kicker">Show them what’s possible</p><h2 id="demo-heading">Your venue.<br/><span>Their day.</span></h2></div><p>Add venue photos. Invite a couple to upload theirs. Give them a private gallery they can picture themselves in.</p></div>
    <div className="cinema-comparison" style={{ "--split": `${split}%` } as CSSProperties}>
      <img src={preview} width="1536" height="1024" loading="lazy" alt="Generated example: a fictional couple in the entrance hall at Knotting Hill Place"/>
      <img className="cinema-comparison__before" src={interior} width="1536" height="1024" loading="lazy" alt="Original photograph of the same entrance hall, before adding a couple"/>
      <div className="cinema-comparison__labels" aria-hidden><span>Venue photo</span><span>Personalized preview</span></div>
      <div className="cinema-comparison__divider" aria-hidden><span>↔</span></div>
      <input type="range" min="0" max="100" value={split} onChange={event => setSplit(Number(event.target.value))} aria-label="Compare venue photo with personalized couple preview" aria-valuetext={`${split}% original venue photo visible`}/>
    </div>
    <div className="cinema-demo__caption"><span>Drag to compare · use arrow keys when focused</span><span>Generated example, not a customer gallery. Results vary.</span></div>
    <div className="cinema-deliverables"><p><strong>4</strong><span>Personalized stills</span></p><p><strong>1</strong><span>Branded motion reel</span></p><p><strong>1</strong><span>Private gallery link</span></p></div>
  </section>;
}

const activity = [
  { name: "Gallery opened", icon: Eye, detail: "They’re looking again.", body: "See when a couple opens their gallery.", value: "Viewed", time: "10:42 am" },
  { name: "Gallery shared", icon: Share2, detail: "The gallery is getting shared.", body: "Track share actions alongside gallery views.", value: "Shared", time: "10:45 am" },
  { name: "Date link clicked", icon: MousePointer2, detail: "They want to check a date.", body: "See clicks to your own date-enquiry page.", value: "Date enquiry", time: "10:47 am" },
];
function SalesDemo() {
  const [selected, setSelected] = useState(0);
  const item = activity[selected];
  return <section className="cinema-sales" aria-labelledby="sales-heading">
    <img className="cinema-sales__scene" src="/brand/khp-lawn-1920.webp" width="1920" height="1142" loading="lazy" alt="Knotting Hill Place event lawn, photographed by D. Lacy Photo"/>
    <div className="cinema-sales__copy"><p className="cinema-kicker">Built for your sales team</p><h2 id="sales-heading">The tour ends.<br/><span>The interest<br/>doesn’t have to.</span></h2><p>See who opens, shares and checks a date.<br/>Follow up with something personal.</p><StartLink placement="sales_demo">Try it with your venue</StartLink></div>
    <div className="cinema-workspace" aria-label="Interactive sales workspace demonstration">
      <div className="cinema-workspace__bar"><DreemerLogo variant="mark" href={null}/><span>Venue workspace</span><span className="cinema-sample-label">Sample data</span></div>
      <div className="cinema-workspace__heading"><div><small>Gallery activity</small><h3>Alex & Jordan</h3></div><span>Private gallery</span></div>
      <div className="cinema-workspace__content"><img src={preview} width="1536" height="1024" loading="lazy" alt="Generated example gallery cover for fictional couple Alex and Jordan"/><div className="cinema-workspace__events">{activity.map((event, i) => <button key={event.name} type="button" aria-pressed={selected === i} onClick={() => setSelected(i)}><event.icon size={18}/><span>{event.name}<small>{event.time}</small></span><span aria-hidden>{selected === i ? "●" : "○"}</span></button>)}</div></div>
      <div className="cinema-workspace__insight" aria-live="polite"><span>{item.value}</span><h4>{item.detail}</h4><p>{item.body}</p></div>
      <p className="cinema-workspace__note">Interactive example. Engagement is not a confirmed booking.</p>
    </div>
  </section>;
}

export default function VenueLandingPage() {
  const config = usePublicConfig();
  const isOperator = useIsOperator();
  const [plan, setPlan] = useState<"starter" | "growth" | "pack">("starter");
  useEffect(() => { trackOnce("landing_view:/", "landing_view", { page: "/" }); }, []);
  const plans = {
    starter: { name: "Starter", price: config.pricing.starterMonthly, credits: config.pricing.starterCredits, cadence: "/ month" },
    growth: { name: "Growth", price: config.pricing.growthMonthly, credits: config.pricing.growthCredits, cadence: "/ month" },
    pack: { name: "Credit pack", price: config.pricing.creditPack, credits: config.pricing.creditPackCredits, cadence: "one time" },
  };
  const selectedPlan = plans[plan];
  const questions = [
    { q: "What does a couple receive?", a: "Four personalized images, a branded motion reel and a private gallery with your date-enquiry link. Your team can review the gallery before sending it." },
    { q: "Do both partners need to agree?", a: `Yes. Both partners consent before their photos are used. Couple uploads are retained for ${config.retentionDays} days under the app’s retention policy.` },
    { q: "Does this guarantee bookings?", a: "No. Dreemer creates personalized follow-up material and tracks engagement. Your team handles enquiries and records confirmed bookings." },
    { q: "How do credits work?", a: "One credit creates one gallery. Failed renders are refunded. Monthly plans renew each month; extra credit packs do not expire." },
  ];
  return <div className="cinema-site">
    <a className="cinema-skip" href="#main-content">Skip to content</a>
    <header className="cinema-header"><DreemerLogo tone="reversed"/><nav aria-label="Main navigation"><a href="#experience">The product</a><a href="#plans">Pricing</a>{isOperator && <Link href="/control" data-testid="header-control-link">Control</Link>}<Link href="/login">Sign in</Link></nav><StartLink placement="header"/></header>
    <main id="main-content">
      <section className="cinema-hero" aria-labelledby="hero-heading"><VenueFilm/><div className="cinema-hero__shade" aria-hidden/>
        <div className="cinema-hero__content"><p className="cinema-kicker">Sales tools for venues</p><h1 id="hero-heading">Turn tours<br/>into <span>bookings.</span></h1><div className="cinema-hero__pitch"><p>Show couples themselves at your venue.</p><p>Personalized previews. Private galleries. Better follow-up.</p><StartLink placement="hero">Try it with your venue <span aria-hidden>↗</span></StartLink><small>{config.trial.credits} free galleries · {config.trial.days} days · No card required</small></div></div>
        <div className="cinema-hero__foot"><a href="#experience">See what couples receive <span aria-hidden>↓</span></a><p>On location: Knotting Hill Place</p></div>
      </section>
      <div className="cinema-workflow" aria-label="How Dreemer works"><span>Add your venue photos</span><span aria-hidden>↗</span><span>Invite a couple</span><span aria-hidden>↗</span><span>Share their gallery</span></div>
      <PhotoDemo/>
      <SalesDemo/>
      <section className="cinema-pricing" id="plans" aria-labelledby="plans-heading"><div><p className="cinema-kicker">Simple pricing</p><h2 id="plans-heading">Start with<br/>{config.trial.credits} free galleries.</h2><p>{config.trial.days} days to try it. No card required.</p><nav aria-label="Choose a plan">{(["starter", "growth", "pack"] as const).map(key => <button key={key} type="button" aria-pressed={plan === key} onClick={() => setPlan(key)}>{plans[key].name}</button>)}</nav></div><div className="cinema-plan" aria-live="polite"><h3>{selectedPlan.name}</h3><p className="cinema-price"><strong>{formatMoney(selectedPlan.price, config.pricing.currency)}</strong><span>{selectedPlan.cadence}</span></p><p>{selectedPlan.credits} galleries{plan === "pack" ? " in each pack" : " each month"}</p><ul><li><Check size={17}/>Personalized galleries</li><li><Check size={17}/>Branded motion reels</li><li><Check size={17}/>Views, shares and date-link tracking</li></ul><StartLink placement={`plan_${plan}`}>Start your free trial</StartLink><small>One credit per gallery. {plan === "pack" ? "Pack credits never expire." : "Monthly billing. Cancel anytime."}</small></div></section>
      <section className="cinema-faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Good questions.</h2><div>{questions.map(entry => <details key={entry.q}><summary>{entry.q}<Plus size={20} aria-hidden/></summary><p>{entry.a}</p></details>)}</div></section>
      <section className="cinema-close"><h2>Make your next tour personal.</h2><StartLink placement="final_ask">Create your first gallery <span aria-hidden>↗</span></StartLink></section>
    </main>
    <footer className="cinema-footer"><div><DreemerLogo tone="reversed"/><nav aria-label="Footer"><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy & photo use</Link>{isOperator && <Link href="/control">Control</Link>}{config.contactEmail && <a href={`mailto:${config.contactEmail}`}>Contact</a>}</nav></div><p>Venue photography: <a href="https://www.knottinghillplace.com/gallery" target="_blank" rel="noopener noreferrer">Knotting Hill Place</a> · White Orchid Photography / Debora Conn; D. Lacy Photo. Used with permission. Example venue, not a claimed customer or partner. Couple preview digitally generated; fictional people.</p><small>© {new Date().getFullYear()} Dreemer</small></footer>
  </div>;
}

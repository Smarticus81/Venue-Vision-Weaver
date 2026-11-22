import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { Plus, Play, Pause, Check, X } from "lucide-react";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { PossibilityLens } from "@/components/landing/PossibilityLens";
import { faqEntries } from "@/components/landing/Faq";
import { formatMoney, usePublicConfig } from "@/lib/publicConfig";
import { clampProgress, experienceChapter } from "@/lib/lensMotion";
import { track, trackOnce } from "@/lib/track";
import { useIsOperator } from "@/lib/operatorAccess";

const venueImage = "/brand/lens-venue-1536.webp";
const visionImage = "/brand/lens-vision-1536.webp";
const chapters = [
  { title: "Start with your space.", label: "Your venue", copy: "Your architecture. Your atmosphere. Your point of difference. Build a reference library from photos of the place your team knows best.", detail: "Venue photos + your booking link" },
  { title: "Make it their possibility.", label: "Their vision", copy: "Couples add their photos with consent. Dreemer creates four AI stills and a branded motion reel, imagined at your venue. A personal reason to revisit the conversation.", detail: "Private gallery + a clear next step" },
  { title: "Know what happens next.", label: "Your next move", copy: "See gallery views, shares and date-link clicks. Follow up with context, and record a booking when the couple signs. A beautiful experience with a business purpose.", detail: "Engagement signals + recorded bookings" },
] as const;

function TrialLink({ children, placement, className = "" }: { children: React.ReactNode; placement: string; className?: string }) {
  return <Link href="/create-venue" className={`lens-cta ${className}`} onClick={() => track("cta_click", { placement })}><span>{children}</span><span className="lens-cta__disc" aria-hidden><Plus size={22} strokeWidth={1.5}/></span></Link>;
}

function ExperienceSequence() {
  const section = useRef<HTMLElement>(null);
  const [chapter, setChapter] = useState<0 | 1 | 2>(0);
  const [comparison, setComparison] = useState(40);
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce), (max-width: 760px)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!section.current || media.matches) return;
      const rect = section.current.getBoundingClientRect();
      const progress = clampProgress(-rect.top / Math.max(1, rect.height - innerHeight));
      section.current.style.setProperty("--story-progress", String(progress));
      setChapter(experienceChapter(progress));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    schedule();
    return () => { removeEventListener("scroll", schedule); removeEventListener("resize", schedule); media.removeEventListener("change", schedule); cancelAnimationFrame(frame); };
  }, []);
  function selectChapter(index: 0 | 1 | 2) {
    setChapter(index);
    if (section.current && !matchMedia("(prefers-reduced-motion: reduce), (max-width: 760px)").matches) {
      const top = section.current.getBoundingClientRect().top + scrollY;
      const range = section.current.offsetHeight - innerHeight;
      window.scrollTo({ top: top + range * ((index + .35) / 3), behavior: "instant" });
    }
  }
  const signals = [
    { label: "Gallery opened", note: "A reason to reconnect.", time: "Viewed" },
    { label: "Shared with someone", note: "The conversation travels.", time: "Shared" },
    { label: "Date link clicked", note: "Bring interest back to your team.", time: "Enquiry intent" },
  ];
  return <section className="lens-story" ref={section} id="experience" aria-labelledby="experience-heading">
    <div className="lens-story__sticky">
      <div className="lens-story__top"><p className="lens-label">One experience. Both sides of the sale.</p><span className="lens-scroll-note">Explore as you scroll</span></div>
      <div className="lens-story__layout">
        <div className="lens-story__copy">
          <nav className="lens-chapters" aria-label="Product story chapters">{chapters.map((item, i) => <button type="button" key={item.label} aria-pressed={chapter === i} onClick={() => selectChapter(i as 0 | 1 | 2)}>{item.label}</button>)}</nav>
          <h2 id="experience-heading">{chapters[chapter].title}</h2>
          <p className="lens-story__description">{chapters[chapter].copy}</p>
          <p className="lens-story__detail"><span aria-hidden>✳</span>{chapters[chapter].detail}</p>
        </div>
        <div className="lens-story__visual" data-chapter={chapter}>
          {chapter === 0 ? <figure className="lens-reference">
            <img src={venueImage} width="1536" height="1024" alt="Illustrative glass pavilion beside a reflecting pool, created with AI" loading="lazy"/>
            <figcaption><span>THE SPACE</span><span>Illustrative venue · AI concept</span></figcaption>
            <div className="lens-reference__tag">Architecture<br/>sets the scene.</div>
          </figure> : chapter === 1 ? <div className="lens-comparison">
            <div className="lens-comparison__images" style={{ "--split": `${comparison}%` } as CSSProperties}>
              <img src={visionImage} width="1536" height="1024" alt="AI preview of a couple at the illustrative glass pavilion"/>
              <img className="lens-comparison__before" src={venueImage} width="1536" height="1024" alt="The illustrative pavilion before personalization"/>
              <div className="lens-comparison__line" aria-hidden><span>↔</span></div>
            </div>
            <label htmlFor="lens-compare">Explore the before and possibility</label>
            <input id="lens-compare" type="range" min="0" max="100" value={comparison} onChange={event => setComparison(Number(event.target.value))} aria-valuetext={`${comparison}% venue reference visible`}/>
            <p>Both images are AI-created demonstrations, not a real customer venue.</p>
          </div> : <div className="lens-signal">
            <div className="lens-signal__orbit" aria-hidden><div/><div/><div/></div>
            <div className="lens-signal__centre"><span>THE SIGNAL</span><strong>{signals[signal].time}</strong><p>{signals[signal].note}</p></div>
            <div className="lens-signal__choices" aria-label="Example engagement signals">{signals.map((item, i) => <button type="button" key={item.label} aria-pressed={signal === i} onClick={() => setSignal(i)}><span aria-hidden>{i === signal ? "●" : "○"}</span>{item.label}</button>)}</div>
            <small>Illustrative activity. A click is interest, not a confirmed booking.</small>
          </div>}
        </div>
      </div>
      <div className="lens-story__progress" aria-hidden><span/></div>
    </div>
  </section>;
}

function Film() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  function open() {
    dialog.current?.showModal();
    setError(false);
    void video.current?.play().catch(() => setError(true));
  }
  function close() { video.current?.pause(); dialog.current?.close(); }
  return <>
    <button className="lens-film-link" type="button" onClick={open}><span className="lens-film-link__play"><Play size={17} fill="currentColor"/></span>Watch the product film <small>15 sec</small></button>
    <dialog ref={dialog} className="lens-film-dialog" aria-label="Dreemer product film" onCancel={() => video.current?.pause()} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div><div className="lens-film-dialog__bar"><span>Dreemer / the possibility lens</span><button type="button" onClick={close} aria-label="Close product film"><X size={24}/></button></div>
        <video ref={video} controls playsInline preload="none" poster="/brand/lens-film-poster.webp" aria-label="Dreemer motion-design product film" onError={() => setError(true)}>
          <source src="/brand/lens-film.mp4" type="video/mp4"/>
          <track kind="captions" src="/brand/lens-film.vtt" srcLang="en" label="English" default/>
        </video>
        {error && <p role="status">Use the player controls or <a href="/brand/lens-film.mp4" target="_blank" rel="noopener noreferrer">open the film directly</a>.</p>}
        <p>Motion-design film with AI concept imagery. Illustrative, not customer footage or Seedance video.</p>
      </div>
    </dialog>
  </>;
}

export default function VenueLandingPage() {
  const config = usePublicConfig();
  const isOperator = useIsOperator();
  const hero = useRef<HTMLElement>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [possibility, setPossibility] = useState(false);
  const [plan, setPlan] = useState<"starter" | "growth" | "pack">("starter");
  useEffect(() => { trackOnce("landing_view:/", "landing_view", { page: "/" }); }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce), (max-width: 760px)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!hero.current) return;
      const progress = motionPaused || media.matches ? 0 : clampProgress(-hero.current.getBoundingClientRect().top / innerHeight);
      hero.current.style.setProperty("--travel", String(progress));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    schedule();
    return () => { removeEventListener("scroll", schedule); removeEventListener("resize", schedule); media.removeEventListener("change", schedule); cancelAnimationFrame(frame); };
  }, [motionPaused]);
  const plans = {
    starter: { name: "Starter", price: config.pricing.starterMonthly, credits: config.pricing.starterCredits, cadence: "/ month", copy: "For a venue ready to make every follow-up personal.", features: ["Personalized AI galleries", "Branded motion reels", "Gallery engagement tracking"] },
    growth: { name: "Growth", price: config.pricing.growthMonthly, credits: config.pricing.growthCredits, cadence: "/ month", copy: "For more tours, more spaces, and a growing sales team.", features: ["Everything in Starter", "Credits shared across your venues", "More galleries for a full tour calendar"] },
    pack: { name: "Credit pack", price: config.pricing.creditPack, credits: config.pricing.creditPackCredits, cadence: "one time", copy: "Extra room for a busy weekend. Add credits when you need them.", features: ["Added to your shared balance", "Pack credits never expire", "No additional subscription"] },
  };
  const selectedPlan = plans[plan];
  return <div className="lens-site">
    <a className="lens-skip" href="#main-content">Skip to content</a>
    <header className="lens-header"><DreemerLogo/><nav aria-label="Main navigation"><a href="#experience">The experience</a><a href="#plans">Plans</a>{isOperator && <Link href="/control" className="lens-operator" data-testid="header-control-link">Control</Link>}<Link href="/login">Sign in</Link></nav><Link href="/create-venue" className="lens-header__start" onClick={() => track("cta_click", { placement: "header" })}>Start free <Plus size={17}/></Link></header>
    <main id="main-content">
      <section ref={hero} className="lens-hero" aria-labelledby="lens-hero-title">
        <div className="lens-hero__atmosphere" aria-hidden/>
        <p className="lens-hero__eyebrow lens-label">Visual sales software for remarkable venues</p>
        <div className="lens-hero__type"><h1 id="lens-hero-title">Beyond<br/>the tour<span>.</span></h1><p>They’ve seen the space.<br/>Now make it personal.</p></div>
        <div className="lens-object" data-vision={possibility}>
          <div className="lens-object__ring lens-object__ring--outer" aria-hidden/><div className="lens-object__ring lens-object__ring--inner" aria-hidden/>
          <div className="lens-object__glass">
            <picture><source media="(max-width: 760px)" srcSet="/brand/lens-venue-800.webp"/><img src={venueImage} width="1536" height="1024" fetchPriority="high" alt="AI concept of an extraordinary glass pavilion beside water"/></picture>
            <img className="lens-object__vision" src="/brand/lens-vision-800.webp" width="800" height="533" alt={possibility ? "AI preview of a couple within the same pavilion" : ""} aria-hidden={!possibility}/>
            <PossibilityLens vision={possibility} paused={motionPaused}/>
            <div className="lens-object__shine" aria-hidden/>
          </div>
          <button type="button" className="lens-object__switch" aria-pressed={possibility} onClick={() => setPossibility(!possibility)}><span>{possibility ? "Back to the space" : "See the possibility"}</span><Plus size={20}/></button>
          <span className="lens-object__label">YOUR SPACE. THEIR POSSIBILITY.</span>
        </div>
        <div className="lens-hero__bottom"><div className="lens-hero__pitch"><p>Turn venue tours into booking conversations—with personal AI previews and engagement signals your sales team can act on.</p><TrialLink placement="hero" className="lens-hero__cta">Create your venue experience</TrialLink><small>{config.trial.credits} galleries · {config.trial.days} days · No card required</small></div><div className="lens-hero__aside"><Film/><p>Concept venue & AI preview imagery.</p><button type="button" className="lens-motion-control" aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>{motionPaused ? <Play size={13}/> : <Pause size={13}/>} {motionPaused ? "Enable lens motion" : "Pause lens motion"}</button></div></div>
      </section>
      <section className="lens-manifesto" aria-labelledby="manifesto-heading"><p className="lens-label">A beautiful space gets attention.</p><h2 id="manifesto-heading">A personal connection<br/>moves the <span>conversation.</span></h2><div><span className="lens-asterisk" aria-hidden>✳</span><p>Your venue isn’t a list of features. It’s a possibility. Dreemer helps couples see themselves in it—and helps your team turn that feeling into a next step.</p></div></section>
      <ExperienceSequence/>
      <section className="lens-outcome" aria-labelledby="outcome-heading">
        <div className="lens-outcome__word" aria-hidden>possibility</div>
        <div className="lens-outcome__image"><img src={visionImage} width="1536" height="1024" loading="lazy" alt="Personalized AI concept preview at the glass pavilion"/><span>AI preview · illustrative venue and couple</span></div>
        <div className="lens-outcome__copy"><p className="lens-label">Not another attachment. An experience.</p><h2 id="outcome-heading">Stay in the<br/><span>picture.</span></h2><p>Four stills. One motion reel. A private gallery worth opening again. Your date-enquiry link stays with it, so the next conversation leads back to your business.</p><a href="#experience" className="lens-text-link">Explore how it works</a></div>
      </section>
      <section className="lens-control" aria-labelledby="control-heading"><div><p className="lens-label">Built for the team behind the venue</p><h2 id="control-heading">The magic is personal.<br/>The control is yours.</h2></div><div className="lens-control__lines"><p><strong>One workspace.</strong><span>Manage venues and shared credits together.</span></p><p><strong>Your standards.</strong><span>Review galleries before they are sent.</span></p><p><strong>A clearer follow-up.</strong><span>Views, shares and date clicks give your team context.</span></p><p><strong>Consent comes first.</strong><span>Both partners agree before their photos are used.</span></p></div></section>
      <section className="lens-plans" id="plans" aria-labelledby="plans-heading"><div className="lens-plans__intro"><p className="lens-label">Room to begin. Room to grow.</p><h2 id="plans-heading">Your next tour<br/>is a good start.</h2><p>Try {config.trial.credits} galleries over {config.trial.days} days. No card, no commitment. Then choose what fits your venue.</p><nav aria-label="Choose a plan">{(["starter","growth","pack"] as const).map(key => <button type="button" key={key} aria-pressed={plan === key} onClick={() => setPlan(key)}>{plans[key].name}</button>)}</nav></div><div className="lens-plan-detail" aria-live="polite"><div className="lens-plan-price"><strong>{formatMoney(selectedPlan.price, config.pricing.currency)}</strong><span>{selectedPlan.cadence}</span></div><h3>{selectedPlan.credits} galleries{plan === "pack" ? ", when you need them." : " each month."}</h3><p>{selectedPlan.copy}</p><ul>{selectedPlan.features.map(feature => <li key={feature}><Check size={16}/>{feature}</li>)}</ul><TrialLink placement={`plan_${plan}`}>Start your free trial</TrialLink><small>One credit per gallery. Failed renders are refunded. {plan !== "pack" && "Monthly billing. Cancel any time."}</small></div></section>
      <section className="lens-faq" aria-labelledby="faq-heading"><div><p className="lens-label">A few things worth knowing</p><h2 id="faq-heading">Before<br/> you begin.</h2></div><div>{faqEntries(config).map(entry => <details key={entry.q}><summary>{entry.q}<Plus size={20} aria-hidden/></summary><p>{entry.a}</p></details>)}</div></section>
      <section className="lens-finale"><div className="lens-finale__halo" aria-hidden/><p className="lens-label">Your space is only the beginning.</p><h2>Give them<br/>something to<br/><span>come back to.</span></h2><TrialLink placement="final_ask">Build your venue experience</TrialLink><p>{config.trial.credits} free galleries. No card required.</p></section>
    </main>
    <footer className="lens-footer"><DreemerLogo/><p>A new perspective on venue sales.</p><nav aria-label="Footer"><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy & AI</Link>{isOperator && <Link href="/control">Control</Link>}{config.contactEmail && <a href={`mailto:${config.contactEmail}`}>Contact</a>}</nav><small>© {new Date().getFullYear()} Dreemer</small></footer>
  </div>;
}

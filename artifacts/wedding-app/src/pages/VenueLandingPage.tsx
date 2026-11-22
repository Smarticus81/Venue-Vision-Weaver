import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { BarChart3, Building2, Check, CheckCheck, Image, LayoutDashboard, MousePointer2, Play, ScanLine, Share2 } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { PricingCards } from "@/components/landing/PricingCards";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import { Faq } from "@/components/landing/Faq";
import { usePublicConfig } from "@/lib/publicConfig";
import { GALLERY_FRAMES, COMPARE_IMAGES } from "@/lib/brandAssets";
import { track, trackOnce } from "@/lib/track";

// This page sells a venue sales workflow, not a wedding aesthetic.
// The interactive illustration uses sample data; it never implies measured results.
export function ProductPreview() {
  const [view, setView] = useState<"pipeline" | "gallery" | "venue">("pipeline");
  const [scene, setScene] = useState(0);
  const activeFrame = GALLERY_FRAMES[scene];
  return (
    <div className="product-stage" id="product">
      <div className="product-stage__caption"><span>Explore the product</span><span>Interactive illustration · sample data</span></div>
      <div className="product-window">
        <aside className="product-rail">
          <DreemerLogo tone="mono" href={null} />
          <div className="product-workspace"><Building2 size={18}/><span>Northline Estate<small>Example workspace</small></span></div>
          <nav aria-label="Product preview views">
            <button type="button" aria-pressed={view === "pipeline"} onClick={()=>setView("pipeline")}><LayoutDashboard size={18}/>Sales overview</button>
            <button type="button" aria-pressed={view === "gallery"} onClick={()=>setView("gallery")}><Image size={18}/>Gallery experience</button>
            <button type="button" aria-pressed={view === "venue"} onClick={()=>setView("venue")}><Building2 size={18}/>Venue library</button>
          </nav>
          <div className="product-rail__foot">YOUR VENUE.<br/>THEIR NEXT STEP.</div>
        </aside>
        <div className="product-work">
          <div className="product-toolbar"><span>Northline Estate / {view === "pipeline" ? "Sales overview" : view === "gallery" ? "Gallery experience" : "Venue library"}</span><span className="product-avatar" aria-hidden>NE</span></div>
          {view === "pipeline" ? (
            <div className="product-panel">
              <div className="product-heading"><div><p className="product-kicker">The conversation after the tour</p><h3>Interest you can see.</h3></div><button type="button" onClick={()=>setView("gallery")} className="product-demo-button">Explore a gallery</button></div>
              <div className="product-stat-strip"><div><span>Sent</span><strong>24</strong></div><div><span>Viewed</span><strong>18</strong></div><div><span>Date-link clicks</span><strong>7</strong></div><div><span>Marked booked</span><strong>3</strong></div></div>
              <div className="product-content-grid">
                <div className="product-table-wrap">
                  <table className="product-table"><caption>Example gallery activity</caption><thead><tr><th>Couple</th><th>Latest signal</th></tr></thead><tbody>
                    <tr><td><strong>Lena &amp; James</strong><small>Personalized gallery</small></td><td><span className="signal-label"><MousePointer2 size={14}/>Date link clicked</span></td></tr>
                    <tr><td><strong>Alex &amp; Morgan</strong><small>Personalized gallery</small></td><td><span><Share2 size={14}/>Shared</span></td></tr>
                    <tr><td><strong>Sam &amp; Charlie</strong><small>Personalized gallery</small></td><td><span><CheckCheck size={14}/>Viewed</span></td></tr>
                  </tbody></table>
                  <p className="product-table-note">Follow engagement. Record bookings when they sign.</p>
                </div>
                <button type="button" className="product-image-link" onClick={()=>setView("gallery")} aria-label="Explore the example personalized gallery">
                  <img src={GALLERY_FRAMES[2].src} alt={GALLERY_FRAMES[2].alt} width={640} height={480} fetchPriority="high"/>
                  <span>From your venue to their vision<small>Open gallery illustration</small></span>
                </button>
              </div>
            </div>
          ) : view === "gallery" ? (
            <div className="product-panel gallery-demo">
              <div className="product-heading"><div><p className="product-kicker">A visual follow-up, built around your venue</p><h3>A reason to come back.</h3></div><span className="demo-disclosure">Example venue &amp; couple · AI preview</span></div>
              <div className="gallery-demo__layout"><img key={activeFrame.src} src={activeFrame.src} alt={activeFrame.alt} width={640} height={480}/><div><p>Four personalized stills. One motion reel. Your next step.</p><div className="gallery-demo__choices" aria-label="Example gallery frames">{GALLERY_FRAMES.map((frame,i)=><button key={frame.src} type="button" aria-pressed={scene===i} onClick={()=>setScene(i)}>{i===3?<Play size={16}/>:<Image size={16}/>} {frame.label}</button>)}</div><div className="demo-date-link">Your venue’s date enquiry link</div><small>The fourth image is a reel poster, not video playback.</small></div></div>
            </div>
          ) : (
            <div className="product-panel">
              <div className="product-heading"><div><p className="product-kicker">Set up once. Use across your tours.</p><h3>Your space is the source.</h3></div><span className="demo-disclosure">Illustrative reference library</span></div>
              <div className="library-demo"><img {...COMPARE_IMAGES.room}/><div><h4>Build a complete venue reference set.</h4><p>Your venue’s architecture and spaces guide the previews. Add coverage for every part of the experience.</p><ul>{["Exterior","Ceremony","Reception","Architectural detail","Natural light"].map(label=><li key={label}><Check size={17}/>{label}</li>)}</ul><Link href="/create-venue" className="action-secondary">Set up your venue</Link></div></div>
            </div>
          )}
        </div>
      </div>
      <p className="product-stage__note">Illustrative interface and activity, not customer results. Images shown are labelled AI previews.</p>
    </div>
  );
}

function ProductVideo() {
 const videoRef=useRef<HTMLVideoElement>(null);
 const [playError,setPlayError]=useState(false);
 return <div className="product-video" id="product-video">
  <div className="product-video__bar"><span>THE VENUE SALES WORKFLOW</span><button type="button" onClick={()=>{setPlayError(false); void videoRef.current?.play().catch(()=>setPlayError(true));}}><Play size={16}/> Watch the 15-second walkthrough</button></div>
  <video ref={videoRef} controls playsInline preload="none" poster="/brand/product-tour-poster.webp" aria-label="Dreemer product walkthrough" onError={()=>setPlayError(true)}>
   <source src="/brand/product-tour.mp4" type="video/mp4"/>
   <track kind="captions" src="/brand/product-tour.vtt" srcLang="en" label="English" default/>
   Your browser does not support video. <a href="/brand/product-tour.mp4">Open the product walkthrough</a>.
  </video>
  {playError ? <p role="status">Playback could not start. <a href="/brand/product-tour.mp4" target="_blank" rel="noopener noreferrer">Open the video directly</a>.</p> : null}
  <p className="product-video__disclosure">Silent product walkthrough · Illustrative interface and activity, not customer results. AI preview imagery.</p>
 </div>;
}

export default function VenueLandingPage() {
 const config=usePublicConfig();
 useEffect(()=>{trackOnce("landing_view:/","landing_view",{page:"/"});},[]);
 return (
  <div className="site-page revenue-site">
   <SiteHeader/>
   <main id="main-content">
    <section className="revenue-hero page-width" aria-labelledby="hero-heading">
     <div className="revenue-hero__top">
      <div><p className="revenue-eyebrow">Visual sales software for venues</p><h1 id="hero-heading">THE TOUR ENDS.<br/><span>THE SALE DOESN’T.</span></h1></div>
      <div className="revenue-hero__pitch"><p>Give your best prospects more than a follow-up email.</p><p>Turn your venue photos into personalized AI galleries. See who engages. Bring the conversation back to booking your space.</p><Link href="/create-venue" className="action-primary" data-testid="venue-hero-register" onClick={()=>track("cta_click",{placement:"hero"})}>Build your venue workspace</Link><small>{config.trial.credits} galleries · {config.trial.days}-day trial · No card required</small></div>
     </div>
     <ProductVideo/>
    </section>
    <section className="sales-thesis page-width" aria-labelledby="sales-thesis-heading">
     <p className="revenue-eyebrow">Built for the people who sell the space</p>
     <h2 id="sales-thesis-heading">A BEAUTIFUL VENUE IS THE START.<br/>A STRONGER SALES PROCESS IS THE ADVANTAGE.</h2>
     <div className="sales-thesis__columns"><p>Brochures show what a venue looks like. Dreemer helps each couple picture themselves there—and gives your team a view of what happens next.</p><p>Use it during a tour or in the follow-up. Keep your venue at the centre of the decision, with a direct path from their private gallery to your date enquiry.</p></div>
    </section>
    <section className="sales-flow" id="how-it-works" aria-labelledby="flow-heading">
     <div className="page-width"><div className="sales-section-heading"><div><p className="revenue-eyebrow">From first impression to next action</p><h2 id="flow-heading">MAKE EVERY TOUR<br/>WORK HARDER.</h2></div><p>One connected workflow. Your venue, your team, your booking conversation.</p></div>
     <div className="sales-flow__steps">
      <article><Building2 size={28}/><h3>Build your venue library</h3><p>Add your spaces and booking link. References guide the gallery toward your venue—not a generic backdrop.</p><span>YOUR FOUNDATION</span></article>
      <article><ScanLine size={28}/><h3>Make it personal</h3><p>Share your QR code or link. Couples add their photos with consent and receive a gallery imagined at your venue.</p><span>YOUR SALES EXPERIENCE</span></article>
      <article><BarChart3 size={28}/><h3>Follow the interest</h3><p>Track gallery views, shares and date-link clicks. Mark confirmed bookings so your team can see the outcome.</p><span>YOUR NEXT CONVERSATION</span></article>
     </div></div>
    </section>
    <section className="product-explore page-width" aria-label="Interactive product demonstration"><ProductPreview/></section>
    <section className="sales-delivery page-width" aria-labelledby="delivery-heading">
     <div className="sales-delivery__copy"><p className="revenue-eyebrow">The product behind the pitch</p><h2 id="delivery-heading">THEY SEE<br/>THE POSSIBILITY.<br/><span>YOU SEE THE SIGNAL.</span></h2><p>A private, venue-branded experience couples can revisit and share. A workspace your team can use to follow the conversation.</p><a href="#product" className="text-link">Explore the interactive product preview</a></div>
     <div className="sales-delivery__list"><article><span>Personalized visuals</span><h3>Your venue is the story.</h3><p>Four AI stills and a branded motion reel, created from venue references and the couple’s own photos.</p></article><article><span>Built-in next step</span><h3>Inspiration needs somewhere to go.</h3><p>Your date enquiry link stays with the gallery. Interest leads back to your business.</p></article><article><span>Owner controls</span><h3>Your team stays in control.</h3><p>Review galleries before sending, manage shared credits and track engagement across your venues.</p></article></div>
    </section>
    <div className="business-case"><RoiCalculator pricing={config.pricing}/></div>
    <section className="pricing-section page-width" id="pricing" aria-labelledby="pricing-heading"><div className="sales-section-heading"><div><p className="revenue-eyebrow">A clear cost per opportunity</p><h2 id="pricing-heading">START WITH YOUR NEXT TOUR.<br/>SCALE WITH YOUR BUSINESS.</h2></div><p>One credit creates one gallery. Share credits across your venues. Monthly subscriptions, with extra credits when you need them.</p></div><PricingCards pricing={config.pricing} trial={config.trial} placement="landing_pricing"/></section>
    <Faq config={config} heading="Before you bring it to your sales team."/>
    <section className="sales-final"><div className="page-width"><div><p className="revenue-eyebrow">Your venue deserves a better follow-up</p><h2>DON’T JUST<br/>SHOW THE SPACE.<br/><span>SELL THE POSSIBILITY.</span></h2></div><div><Link href="/create-venue" className="action-primary" data-testid="venue-trial-register" onClick={()=>track("cta_click",{placement:"final_ask"})}>Start your free venue trial</Link><p>{config.trial.credits} galleries. {config.trial.days} days. No card needed.</p><Link href="/login" className="text-link" data-testid="venue-trial-sign-in">Already have a workspace? Sign in</Link></div></div></section>
   </main>
   <SiteFooter/>
  </div>
 );
}

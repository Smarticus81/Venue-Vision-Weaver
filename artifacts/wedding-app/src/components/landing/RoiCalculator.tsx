import { useId, useMemo, useState } from "react";
import type { PricingConfig } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/publicConfig";
import { computeRoi, parseRoiNumber, ROI_DEFAULTS, ROI_LIMITS } from "@/lib/roi";

/*
 * Four editable assumptions drive a gross-revenue scenario, not a forecast
 * or a profit/payback promise. Plan costs include monthly top-ups.
 */

const PLAN_NAMES = { starter: "Starter", growth: "Growth" } as const;

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function RoiCalculator({ pricing }: { pricing: PricingConfig }) {
  const ids = useId();
  const [tours, setTours] = useState(String(ROI_DEFAULTS.toursPerMonth));
  const [percent, setPercent] = useState(String(ROI_DEFAULTS.tourToBookingPercent));
  const [value, setValue] = useState(String(ROI_DEFAULTS.averageBookingValue));
  const [lift, setLift] = useState(String(ROI_DEFAULTS.liftPoints));

  const input = useMemo(
    () => ({
      toursPerMonth: parseRoiNumber(tours),
      tourToBookingPercent: parseRoiNumber(percent),
      averageBookingValue: parseRoiNumber(value),
      liftPoints: parseRoiNumber(lift),
    }),
    [tours, percent, value, lift],
  );
  const out = useMemo(() => computeRoi(input, pricing), [input, pricing]);
  const currency = pricing.currency;
  const plan = PLAN_NAMES[out.planSuggestion];

  return (
    <section className="roi-section page-width" aria-labelledby={`${ids}-heading`} id="roi">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Make the decision with your numbers</p>
          <h2 id={`${ids}-heading`}>What would make it worthwhile?</h2>
        </div>
        <p>
          Explore a revenue scenario against the subscription and credits you would need.
          Every default is illustrative, not measured venue performance.
        </p>
      </div>

      <div className="roi-grid">
        <form className="roi-form" onSubmit={(e) => e.preventDefault()}>
          <div className="roi-field">
            <label htmlFor={`${ids}-tours`}>Tours a month</label>
            <input
              id={`${ids}-tours`}
              type="number"
              inputMode="numeric"
              min={ROI_LIMITS.toursPerMonth.min}
              max={ROI_LIMITS.toursPerMonth.max}
              step={1}
              value={tours}
              onChange={(e) => setTours(e.target.value)}
              aria-describedby={`${ids}-tours-hint`}
            />
            <small id={`${ids}-tours-hint`}>Default {ROI_DEFAULTS.toursPerMonth}</small>
          </div>
          <div className="roi-field">
            <label htmlFor={`${ids}-percent`}>Tours that book today</label>
            <div className="roi-unit">
              <input
                id={`${ids}-percent`}
                type="number"
                inputMode="numeric"
                min={ROI_LIMITS.tourToBookingPercent.min}
                max={ROI_LIMITS.tourToBookingPercent.max}
                step={1}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-describedby={`${ids}-percent-hint`}
              />
              <span aria-hidden>%</span>
            </div>
            <small id={`${ids}-percent-hint`}>Default {ROI_DEFAULTS.tourToBookingPercent}%</small>
          </div>
          <div className="roi-field">
            <label htmlFor={`${ids}-value`}>Average booking value</label>
            <div className="roi-unit">
              <span aria-hidden>{currencySymbol(currency)}</span>
              <input
                id={`${ids}-value`}
                type="number"
                inputMode="numeric"
                min={ROI_LIMITS.averageBookingValue.min}
                max={ROI_LIMITS.averageBookingValue.max}
                step={100}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-describedby={`${ids}-value-hint`}
              />
            </div>
            <small id={`${ids}-value-hint`}>
              Default {formatMoney(ROI_DEFAULTS.averageBookingValue, currency)}
            </small>
          </div>
          <div className="roi-field">
            <label htmlFor={`${ids}-lift`}>Possible booking-rate increase</label>
            <div className="roi-unit">
              <input id={`${ids}-lift`} type="number" inputMode="decimal" min={0} max={100} step={0.5}
                value={lift} onChange={(e) => setLift(e.target.value)} aria-describedby={`${ids}-lift-hint`} />
              <span aria-hidden>points</span>
            </div>
            <small id={`${ids}-lift-hint`}>Your assumption. Try 0 to see the cost without any increase.</small>
          </div>
        </form>

        <output
          className="roi-output"
          aria-live="polite"
          htmlFor={`${ids}-tours ${ids}-percent ${ids}-value ${ids}-lift`}
        >
          <p className="roi-figure">
            <strong>+{formatNumber(out.extraBookingsPerYear)}</strong>
            <span>possible extra bookings a year</span>
          </p>
          <p className="roi-money">
            <strong>{formatMoney(out.extraRevenuePerYear, currency)}</strong> potential gross revenue a year
          </p>
          <p className="roi-detail">
            At {formatNumber(out.assumptions.toursPerMonth)} tours a month and {formatNumber(out.assumptions.tourToBookingPercent)}%
            booking, the starting point is about {formatNumber(out.bookingsNowPerYear)} weddings a year.
            The modeled increase is {formatNumber(out.assumptions.liftPoints)} percentage points, capped at a 100% booking rate. The lower-cost subscription
            combination for this tour volume is {plan}{out.extraPacksPerMonth > 0 ? ` plus ${out.extraPacksPerMonth} credit pack(s) per month` : ""}:
            {" "}{formatMoney(out.planCostPerYear, currency)} a year before tax.
          </p>
        </output>
      </div>
      <p className="caption">
        Revenue is not profit. This scenario excludes the cost of hosting extra weddings, your team's
        time and taxes. It assumes one gallery per tour and no carried-over credits. No booking uplift is guaranteed.
      </p>
    </section>
  );
}

function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en-US", { style: "currency", currency })
      .formatToParts(1)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

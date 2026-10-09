import { useId, useMemo, useState } from "react";
import type { PricingConfig } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/publicConfig";
import { computeRoi, LIFT_POINTS, parseRoiNumber, ROI_DEFAULTS, ROI_LIMITS } from "@/lib/roi";

/*
 * ROI calculator (funnel-ux.md 3.6) — the page's one live element. Three
 * inputs in the venue's own units, one output in bookings and money. The
 * default worked example is a pure computation, so the static markup already
 * holds a correct result before React hydrates; typing only re-runs the math.
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

  const input = useMemo(
    () => ({
      toursPerMonth: parseRoiNumber(tours),
      tourToBookingPercent: parseRoiNumber(percent),
      averageBookingValue: parseRoiNumber(value),
    }),
    [tours, percent, value],
  );
  const out = useMemo(() => computeRoi(input, pricing), [input, pricing]);
  const currency = pricing.currency;
  const plan = PLAN_NAMES[out.planSuggestion];
  const payback =
    out.paybackBookings === null
      ? null
      : out.paybackBookings === 1
        ? "paid back by the first booking."
        : `paid back by booking ${out.paybackBookings}.`;

  return (
    <section className="roi-section page-width" aria-labelledby={`${ids}-heading`} id="roi">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What one more booking is worth</p>
          <h2 id={`${ids}-heading`}>Do the math for your venue.</h2>
        </div>
        <p>
          Three numbers you already know. The result is in bookings, not galleries. Defaults are
          placeholders, not your figures.
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
        </form>

        <output
          className="roi-output"
          aria-live="polite"
          htmlFor={`${ids}-tours ${ids}-percent ${ids}-value`}
        >
          <p className="roi-figure">
            <strong>+{formatNumber(out.extraBookingsPerYear)}</strong>
            <span>more bookings a year</span>
          </p>
          <p className="roi-money">
            about <strong>{formatMoney(out.extraRevenuePerYear, currency)}</strong> a year
          </p>
          <p className="roi-detail">
            At {formatNumber(input.toursPerMonth)} tours a month and {formatNumber(input.tourToBookingPercent)}%
            booking, you book about {formatNumber(out.bookingsNowPerYear)} weddings a year. If seeing
            themselves here moves {LIFT_POINTS} couples in a hundred to yes, that is{" "}
            {formatNumber(out.extraBookingsPerYear)} more bookings, about{" "}
            {formatMoney(out.extraRevenuePerYear, currency)} a year. {plan} costs{" "}
            {formatMoney(out.planCostPerYear, currency)} a year{payback ? `, ${payback}` : "."}
          </p>
        </output>
      </div>
      <p className="caption">
        Assumption: +{LIFT_POINTS} points of tour-to-booking. The other numbers are yours; we will
        replace the assumption with opted-in venue data when we have it.
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

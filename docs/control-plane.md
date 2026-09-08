# The autonomous business control plane

glimpse runs itself. A fleet of eight domain agents watches the product's own
data, proposes decisions with their reasoning attached, and — within policy —
executes them. Everything they see, propose, and do is recorded so a human can
audit or reverse it.

This document is the operator's manual: what the agents are accountable for,
what they may do unattended, and how to stop them.

---

## The shape of it

```
                      ┌───────────────────────────────┐
  product events ───► │  signals  (session.failed,    │
  (sessions, venues,  │           venue.created, …)   │
   Stripe webhooks)   └──────────────┬────────────────┘
                                     │
                      ┌──────────────▼────────────────┐
                      │  BusinessSnapshot             │  aggregates only —
                      │  funnel · finance · tickets   │  no couple data,
                      │  leads · experiments · fleet  │  no credentials
                      └──────────────┬────────────────┘
                                     │
   ┌─────────────────────────────────▼──────────────────────────────────┐
   │  the fleet — pure functions, one per domain                        │
   │  product · support · activation · growth · finance · experiments   │
   │  sales · governance                                                │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │  DecisionProposal { rationale,
                                     │  evidence, effect, confidence }
                      ┌──────────────▼────────────────┐
                      │  policy engine (guardrails)   │
                      │  risk · autonomy · budgets    │
                      └───────┬───────────────┬───────┘
                       within │               │ above
                     autonomy │               │ autonomy / high risk
                      ┌───────▼──────┐  ┌─────▼────────────────┐
                      │  executor    │  │  decision queue      │
                      │  (applies)   │  │  (waits for a human) │
                      └───────┬──────┘  └─────┬────────────────┘
                              └───────┬───────┘
                              ┌───────▼───────┐
                              │  audit trail  │
                              └───────────────┘
```

The kernel (`lib/control-plane`) is pure: no database, no network, no clock of
its own. Agents receive a snapshot and return proposals. The api-server
assembles the snapshot, applies policy, executes what clears, and records
everything. That separation is what makes the fleet testable — every agent can
be exercised against a hand-written snapshot (`pnpm run test:control-plane`).

---

## The fleet

| Agent | Domain | Accountable for | Default cadence |
| --- | --- | --- | --- |
| **Product Repair** | `product` | Generation failure rate, delivery latency, retrying transient failures, filing repair and upgrade items | 30 min |
| **Support** | `support` | Triaging every inbound request, drafting replies, escalating what ages out | 15 min |
| **Activation** | `activation` | Getting new venues to their first delivered gallery inside a week | 4 h |
| **Growth** | `growth` | Weekly gallery starts, re-engaging dormant venues, conversion experiments | 3 h |
| **Finance** | `finance` | Credit runway, gross margin, refund rate, conversion-ready trials | 6 h |
| **Experiments** | `experiments` | Keeping a powered test on weak surfaces and calling results honestly | 12 h |
| **Sales** | `sales` | Scoring the pipeline, advancing stages, closing dead leads | 4 h |
| **Governance** | `governance` | Supervising the fleet itself: unhealthy agents, review debt, autonomy drift | 1 h |

Repair runs before revenue. When several agents come due at once the
orchestrator runs product and support first — a broken pipeline invalidates
every other agent's reading of the business — and governance last, so it sees
the results of the same tick.

---

## Autonomy

Each agent has one of four levels, set per organisation in the console:

| Level | What it does |
| --- | --- |
| `observe` | Records observations. Proposes nothing. |
| `recommend` | Proposes everything. Executes nothing. |
| `supervised` | May execute **low-risk** decisions on its own. |
| `autonomous` | May execute **low and medium risk** on its own. |

**There is no level above `autonomous`, and high-risk decisions always wait for
a human.** An agent cannot widen its own authority: the governance agent's
autonomy changes are themselves a high-risk effect, so they land in the queue
like anything else.

### Risk by effect

| Risk | Effects |
| --- | --- |
| low | `report.digest`, `notify.operator`, `memory.write`, `metric.record`, `workItem.upsert`, `workItem.close`, `ticket.triage`, `ticket.draftReply`, `lead.score` |
| medium | `session.retry`, `ticket.resolve`, `ticket.escalate`, `experiment.launch`, `experiment.conclude`, `experiment.abort`, `lead.advance`, `agent.pause`, `agent.resume` |
| high | `venue.nudge`, `lead.outreach`, `credits.grant`, `policy.set`, `agent.setAutonomy` |

Anything that reaches a person outside the company, moves money, or changes the
fleet's own authority starts at high. Magnitude escalates further: a 3-credit
goodwill grant and a 30-credit one are not the same decision.

---

## Guardrails

Org-level policy, editable under **Governance** in the console:

| Key | Default | Meaning |
| --- | --- | --- |
| `killSwitch` | `false` | Master stop. Nothing executes, including decisions a human approves. |
| `autoExecuteEnabled` | `true` | When false the fleet observes and proposes but never self-executes. |
| `maxAutoExecutionsPerDay` | `40` | Org-wide ceiling on automatic executions per day. |
| `confidenceFloor` | `0.6` | Proposals below this always wait for a human. |
| `alwaysApprove` | `credits.grant`, `policy.set`, `agent.setAutonomy` | Effects that require approval regardless of autonomy. |
| `outboundEmailEnabled` | **`false`** | Whether agents may email venues, couples, or leads. Off until you turn it on. |
| `maxCreditGrant` | `25` | An agent may never propose a grant above this, at any level. |
| `reviewSlaHours` | `48` | Governance flags decisions left open longer than this. |
| `decisionTtlHours` | `168` | Unreviewed decisions expire so the queue reflects live conditions. |

Policy is re-evaluated at execution time, not only when a decision is
proposed: an approval from yesterday does not survive a kill switch engaged
since.

Per-agent limits sit alongside the org policy — a daily action budget (25 by
default) and a schedule interval, both editable per agent.

---

## The decision queue

Every proposal is stored with:

- **rationale** — why, in prose, with the numbers that drove it;
- **evidence** — the raw figures, so the reasoning can be checked;
- **effect** — exactly what will happen if approved, as structured JSON;
- **confidence** and **impact**, used to rank the queue;
- a **dedupe key**, so a standing condition produces one open decision rather
  than one per tick. A decision a human already rejected is never silently
  resurrected.

Approving executes the effect immediately and records the outcome. Rejecting
records the refusal — and a pattern of rejections is itself a signal: the
governance agent proposes narrowing the autonomy of an agent whose decisions
are rejected more often than not.

---

## Effects the fleet can apply

| Effect | What it does |
| --- | --- |
| `session.retry` | Re-queues a failed gallery. Buys the credit back first, so a retry loop cannot generate galleries the organisation never paid for. Only transient failures (timeouts, provider quota, restarts) are ever retried. |
| `workItem.upsert` / `workItem.close` | Files or closes a repair/upgrade item in the product backlog. |
| `ticket.triage` / `ticket.draftReply` / `ticket.resolve` / `ticket.escalate` | Support inbox operations. Drafting is low risk precisely because it does not reach the requester — sending stays a human's call. |
| `experiment.launch` / `conclude` / `abort` | Experiment lifecycle. Conclusions come from a two-proportion test against the declared sample size. |
| `lead.score` / `lead.advance` / `lead.outreach` | Pipeline hygiene and (high risk) outbound contact. |
| `venue.nudge` | Emails a venue. Requires `outboundEmailEnabled` and approval. |
| `credits.grant` | Grants credits to the organisation. Always requires approval; capped by `maxCreditGrant`. |
| `agent.pause` / `agent.resume` / `agent.setAutonomy` | Governance acting on the fleet. |
| `notify.operator` / `report.digest` | Alerts and the daily governance digest. |
| `memory.write` / `metric.record` | Durable agent memory and daily KPI rollups. |

Every effect is scoped to the organisation on the execution context. An effect
can never reach another tenant's data, even if an agent proposes an id it
should not have seen.

---

## Running it

The worker starts with the API server and needs no extra services.

```bash
# Create the control plane tables (required once)
pnpm run db:push

# Exercise the kernel against hand-written snapshots
pnpm run test:control-plane
```

Open the console at **`/ops`** (signed in, with an active organisation).

Access matches the rest of the owner surface: any member of the Clerk
organisation can read the console and change guardrails, the same bar that
already applies to billing and credits. If you need the kill switch and
autonomy controls restricted to admins, that is a role gate to add in
`artifacts/api-server/src/routes/controlPlane.ts` — `requireOrg` already
returns the caller's `orgRole`.

Without its tables the whole feature degrades cleanly: the console shows a
"not migrated" notice, the API returns `503 control_plane_not_migrated`, the
worker no-ops, and `/api/readyz` reports `controlPlane: degraded`.

### Environment

All optional — see `.env.example` for the full list with defaults.

| Variable | Purpose |
| --- | --- |
| `CONTROL_PLANE_WORKER=off` | Keep the console and API available with nothing running on a schedule. |
| `CONTROL_PLANE_POLL_MS` | How often the worker looks for due agents (default 60000). |
| `CONTROL_PLANE_MAX_ORGS_PER_TICK` | Organisations ticked per pass (default 5). |
| `CONTROL_PLANE_OPERATOR_EMAIL` | Where operator alerts go. Defaults to the oldest venue's owner. |
| `CONTROL_PLANE_NARRATION=off` | Disable the written narration of each run. |
| `CONTROL_PLANE_PRICE_STARTER_USD`, `CONTROL_PLANE_PRICE_GROWTH_USD` | List prices used only for the margin estimate. |

### On the model

Decisions are produced **deterministically**. Every proposal in this system
comes from explicit rules over measured data — the same snapshot always yields
the same proposals, which is what makes the tests above meaningful and the
rationale trustworthy.

The model (Gemini, via `GOOGLE_AI_API_KEY`) is used for one thing: writing a
few sentences of narration on each run so the console reads like a colleague's
note rather than a table. It never chooses an action, and narration failing —
or the key being absent — changes nothing about what the fleet does.

---

## Stopping it

1. **One agent** — pause it, or drop it to `observe`, on the Fleet tab.
2. **All execution, keep the analysis** — turn off `autoExecuteEnabled`.
3. **Everything** — engage the kill switch under Governance. Agents keep
   observing so the queue reflects reality when you release it, but nothing
   executes, including decisions you approve.
4. **The worker itself** — set `CONTROL_PLANE_WORKER=off` and redeploy.

---

## Extending the fleet

1. Add an agent in `lib/control-plane/src/agents/`, exporting an
   `AgentDefinition`. Keep it pure — read the snapshot, return proposals.
2. Register it in `lib/control-plane/src/agents/index.ts`.
3. If it needs a new effect, add it to the `DecisionEffect` union in
   `types.ts`, give it a base risk in `policy.ts`, and implement the handler in
   `artifacts/api-server/src/lib/controlPlane/executor.ts`. The executor's
   switch is exhaustive, so TypeScript will tell you what is missing.
4. If it needs data the snapshot lacks, extend `BusinessSnapshot` and
   `buildBusinessSnapshot`. That function is the boundary of what agents can
   see — widen it deliberately.
5. Add tests to `lib/control-plane/src/controlPlane.test.ts`.

A new effect defaults to high risk if it is not classified, so a forgotten
entry fails safe: it reaches a human rather than executing unattended.

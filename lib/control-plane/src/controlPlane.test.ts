import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_REGISTRY,
  DEFAULT_POLICY,
  classifyTicket,
  effectRisk,
  evaluateProposal,
  financeAgent,
  governanceAgent,
  judgeExperiment,
  planTick,
  productAgent,
  runAgent,
  scoreLead,
  stateOfBusiness,
  supportAgent,
  type AgentContext,
  type BusinessSnapshot,
  type DecisionProposal,
} from "./index.js";

/* ————————————————————————— Fixtures ————————————————————————— */

function emptySnapshot(overrides: Partial<BusinessSnapshot> = {}): BusinessSnapshot {
  const window = { started: 0, ready: 0, failed: 0, processing: 0, medianMinutesToReady: null };
  return {
    now: "2026-01-15T12:00:00.000Z",
    organization: {
      id: 1,
      name: "Test Org",
      plan: "trial",
      creditsBalance: 20,
      hasSubscription: false,
      billingPeriodEnd: null,
      createdAt: "2025-12-01T00:00:00.000Z",
      ageDays: 45,
    },
    venues: [],
    funnel: { last7d: { ...window }, prev7d: { ...window }, last24h: { ...window } },
    failures: [],
    finance: {
      creditsBalance: 20,
      creditsGranted30d: 0,
      creditsBurned30d: 0,
      creditsBurned7d: 0,
      estimatedCogsUsd30d: 0,
      estimatedRevenueUsd30d: 0,
      runwayDays: null,
      refunds30d: 0,
      planPriceUsd: 0,
    },
    tickets: [],
    leads: [],
    experiments: [],
    workItems: [],
    signals: [],
    fleet: [],
    ledger: { openCount: 0, executed24h: 0, approved7d: 0, rejected7d: 0, stale: [], byAgent: [] },
    metrics: {},
    ...overrides,
  };
}

function contextFor(
  snapshot: BusinessSnapshot,
  agentKey: string,
  autonomy: AgentContext["agent"]["autonomy"] = "supervised",
): AgentContext {
  return {
    now: new Date(snapshot.now),
    snapshot,
    agent: { agentKey, autonomy, enabled: true, actionsRemainingToday: 25, config: {} },
    memory: [],
    openDecisions: [],
  };
}

function proposal(overrides: Partial<DecisionProposal> = {}): DecisionProposal {
  return {
    kind: "test.proposal",
    title: "Test",
    rationale: "Because",
    effect: { type: "memory.write", content: "note", importance: 0.5, tags: [] },
    confidence: 0.9,
    impactScore: 10,
    dedupeKey: "test.proposal",
    ...overrides,
  };
}

/* ————————————————————————— Registry ————————————————————————— */

test("the fleet covers all eight business domains exactly once", () => {
  const domains = AGENT_REGISTRY.map((agent) => agent.domain).sort();
  assert.deepEqual(domains, [
    "activation",
    "experiments",
    "finance",
    "governance",
    "growth",
    "product",
    "sales",
    "support",
  ]);
  assert.equal(new Set(AGENT_REGISTRY.map((agent) => agent.key)).size, AGENT_REGISTRY.length);
});

test("no agent ships at autonomous by default", () => {
  for (const agent of AGENT_REGISTRY) {
    assert.notEqual(agent.defaultAutonomy, "autonomous", `${agent.key} defaults to autonomous`);
  }
});

test("every agent survives an empty business without throwing", () => {
  const snapshot = emptySnapshot();
  for (const agent of AGENT_REGISTRY) {
    const { output, error } = runAgent(agent, contextFor(snapshot, agent.key));
    assert.equal(error, null, `${agent.key} threw: ${error}`);
    assert.ok(output, `${agent.key} produced no output`);
    assert.ok(typeof output.summary === "string" && output.summary.length > 0);
  }
});

test("agent proposals carry stable dedupe keys within a tick", () => {
  const snapshot = emptySnapshot();
  for (const agent of AGENT_REGISTRY) {
    const first = runAgent(agent, contextFor(snapshot, agent.key)).output;
    const second = runAgent(agent, contextFor(snapshot, agent.key)).output;
    assert.deepEqual(
      first?.proposals.map((entry) => entry.dedupeKey),
      second?.proposals.map((entry) => entry.dedupeKey),
      `${agent.key} produced unstable dedupe keys`,
    );
  }
});

/* ————————————————————————— Policy ————————————————————————— */

test("high-risk effects always require a human, even at full autonomy", () => {
  const verdict = evaluateProposal(
    proposal({
      effect: { type: "credits.grant", amount: 5, reason: "goodwill", note: "" },
      dedupeKey: "grant",
    }),
    {
      policy: DEFAULT_POLICY,
      autonomy: "autonomous",
      agentEnabled: true,
      agentBudgetRemaining: 10,
      orgAutoBudgetRemaining: 10,
    },
  );
  assert.equal(verdict.admissible, true);
  assert.equal(verdict.requiresApproval, true);
});

test("an agent cannot raise its own autonomy without approval", () => {
  assert.equal(
    effectRisk({
      type: "agent.setAutonomy",
      targetAgentKey: "growth-agent",
      autonomy: "autonomous",
      note: "",
    }),
    "high",
  );
});

test("the kill switch holds everything for review", () => {
  const verdict = evaluateProposal(proposal(), {
    policy: { ...DEFAULT_POLICY, killSwitch: true },
    autonomy: "autonomous",
    agentEnabled: true,
    agentBudgetRemaining: 10,
    orgAutoBudgetRemaining: 10,
  });
  assert.equal(verdict.requiresApproval, true);
  assert.match(verdict.holdReason ?? "", /kill switch/i);
});

test("a credit grant above the ceiling is refused outright, not queued", () => {
  const verdict = evaluateProposal(
    proposal({
      effect: { type: "credits.grant", amount: 500, reason: "", note: "" },
    }),
    {
      policy: DEFAULT_POLICY,
      autonomy: "autonomous",
      agentEnabled: true,
      agentBudgetRemaining: 10,
      orgAutoBudgetRemaining: 10,
    },
  );
  assert.equal(verdict.admissible, false);
  assert.match(verdict.rejectReason ?? "", /ceiling/i);
});

test("observe-only agents propose nothing at all", () => {
  const verdict = evaluateProposal(proposal(), {
    policy: DEFAULT_POLICY,
    autonomy: "observe",
    agentEnabled: true,
    agentBudgetRemaining: 10,
    orgAutoBudgetRemaining: 10,
  });
  assert.equal(verdict.admissible, false);
});

test("outbound email is held while the policy forbids it", () => {
  const verdict = evaluateProposal(
    proposal({
      effect: { type: "venue.nudge", venueId: 1, subject: "s", body: "b", reason: "r" },
    }),
    {
      policy: DEFAULT_POLICY,
      autonomy: "autonomous",
      agentEnabled: true,
      agentBudgetRemaining: 10,
      orgAutoBudgetRemaining: 10,
    },
  );
  assert.equal(verdict.admissible, true);
  assert.equal(verdict.requiresApproval, true);
});

test("a spent budget stops self-execution but keeps the proposal", () => {
  const verdict = evaluateProposal(proposal(), {
    policy: DEFAULT_POLICY,
    autonomy: "autonomous",
    agentEnabled: true,
    agentBudgetRemaining: 0,
    orgAutoBudgetRemaining: 10,
  });
  assert.equal(verdict.admissible, true);
  assert.equal(verdict.requiresApproval, true);
});

test("a low-risk, confident proposal executes on its own at supervised", () => {
  const verdict = evaluateProposal(proposal(), {
    policy: DEFAULT_POLICY,
    autonomy: "supervised",
    agentEnabled: true,
    agentBudgetRemaining: 10,
    orgAutoBudgetRemaining: 10,
  });
  assert.equal(verdict.requiresApproval, false);
  assert.equal(verdict.riskLevel, "low");
});

/* ————————————————————————— Product ————————————————————————— */

test("a failure spike files a repair item naming the dominant family", () => {
  const snapshot = emptySnapshot({
    funnel: {
      last7d: { started: 20, ready: 14, failed: 6, processing: 0, medianMinutesToReady: 6 },
      prev7d: { started: 20, ready: 19, failed: 1, processing: 0, medianMinutesToReady: 6 },
      last24h: { started: 10, ready: 5, failed: 5, processing: 0, medianMinutesToReady: 6 },
    },
    failures: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      venueId: 1,
      venueSlug: "hall",
      errorMessage: "Request timed out talking to the model",
      createdAt: "2026-01-15T09:00:00.000Z",
      ageHours: 3,
      creditsCharged: 0,
    })),
  });

  const output = runAgent(productAgent, contextFor(snapshot, productAgent.key)).output;
  assert.ok(output);
  const repair = output.proposals.find((entry) => entry.kind === "product.failure_spike");
  assert.ok(repair, "expected a repair proposal");
  assert.equal(repair.effect.type, "workItem.upsert");
  assert.match(repair.title, /timeout/i);
});

test("only transient failures are retried; a quality rejection is not", () => {
  const base = {
    venueId: 1,
    venueSlug: "hall",
    createdAt: "2026-01-15T09:00:00.000Z",
    ageHours: 2,
    creditsCharged: 0,
  };
  const snapshot = emptySnapshot({
    failures: [
      { ...base, id: 1, errorMessage: "Request timed out" },
      { ...base, id: 2, errorMessage: "Quality gate rejected the likeness" },
    ],
  });

  const output = runAgent(productAgent, contextFor(snapshot, productAgent.key)).output;
  const retries = output?.proposals.filter((entry) => entry.kind === "product.retry_session") ?? [];
  assert.equal(retries.length, 1);
  assert.deepEqual(retries[0].effect, {
    type: "session.retry",
    sessionId: 1,
    note: "Automatic retry after timeout failure",
  });
});

/* ————————————————————————— Support ————————————————————————— */

test("ticket triage is deterministic and priority follows the content", () => {
  const failed = classifyTicket({
    subject: "Our gallery failed",
    body: "It errored out and the tour is tomorrow",
  });
  assert.equal(failed.category, "gallery_failed");
  assert.equal(failed.priority, "urgent");

  const praise = classifyTicket({ subject: "Thank you", body: "These look amazing" });
  assert.equal(praise.sentiment, "positive");
  assert.equal(praise.priority, "normal");
});

test("support drafts a reply for an untriaged ticket without sending it", () => {
  const snapshot = emptySnapshot({
    tickets: [
      {
        id: 7,
        subject: "Charged twice?",
        body: "I think my card was charged twice for the same month",
        category: "general",
        sentiment: "neutral",
        priority: "normal",
        status: "open",
        source: "email",
        requesterEmail: "owner@venue.example",
        venueId: null,
        sessionId: null,
        hasDraft: false,
        ageHours: 3,
        hoursSinceFirstResponse: null,
      },
    ],
  });

  const output = runAgent(supportAgent, contextFor(snapshot, supportAgent.key)).output;
  const draft = output?.proposals.find((entry) => entry.kind === "support.draft_reply");
  assert.ok(draft);
  assert.equal(draft.effect.type, "ticket.draftReply");
  // Drafting is low risk precisely because it does not reach the requester.
  assert.equal(effectRisk(draft.effect), "low");
});

/* ————————————————————————— Finance ————————————————————————— */

test("finance raises a critical alert when credits run out within days", () => {
  const snapshot = emptySnapshot({
    finance: {
      creditsBalance: 4,
      creditsGranted30d: 25,
      creditsBurned30d: 21,
      creditsBurned7d: 14,
      estimatedCogsUsd30d: 3.28,
      estimatedRevenueUsd30d: 99,
      runwayDays: 2,
      refunds30d: 0,
      planPriceUsd: 99,
    },
  });

  const output = runAgent(financeAgent, contextFor(snapshot, financeAgent.key)).output;
  const alert = output?.proposals.find((entry) => entry.kind === "finance.runway_alert");
  assert.ok(alert);
  assert.equal(alert.effect.type, "notify.operator");
  assert.equal(alert.effect.severity, "critical");
});

/* ————————————————————————— Experiments ————————————————————————— */

test("an experiment below its sample size is never called", () => {
  const verdict = judgeExperiment(
    {
      id: 1,
      key: "test",
      hypothesis: "h",
      surface: "s",
      primaryMetric: "m",
      status: "running",
      minimumSampleSize: 400,
      ageDays: 3,
      variants: [
        { key: "control", label: "Control", exposures: 40, conversions: 4, conversionRate: 0.1 },
        { key: "b", label: "B", exposures: 40, conversions: 20, conversionRate: 0.5 },
      ],
    },
    3,
  );
  assert.equal(verdict.decision, "continue");
});

test("a powered, significant win is called for the challenger", () => {
  const verdict = judgeExperiment(
    {
      id: 1,
      key: "test",
      hypothesis: "h",
      surface: "s",
      primaryMetric: "m",
      status: "running",
      minimumSampleSize: 200,
      ageDays: 10,
      variants: [
        { key: "control", label: "Control", exposures: 500, conversions: 50, conversionRate: 0.1 },
        { key: "b", label: "B", exposures: 500, conversions: 110, conversionRate: 0.22 },
      ],
    },
    10,
  );
  assert.equal(verdict.decision, "conclude");
  assert.equal(verdict.winner, "b");
});

test("an underpowered experiment left running too long is aborted", () => {
  const verdict = judgeExperiment(
    {
      id: 1,
      key: "test",
      hypothesis: "h",
      surface: "s",
      primaryMetric: "m",
      status: "running",
      minimumSampleSize: 5000,
      ageDays: 60,
      variants: [
        { key: "control", label: "Control", exposures: 30, conversions: 3, conversionRate: 0.1 },
        { key: "b", label: "B", exposures: 30, conversions: 4, conversionRate: 0.133 },
      ],
    },
    60,
  );
  assert.equal(verdict.decision, "abort");
});

/* ————————————————————————— Sales ————————————————————————— */

test("lead scoring rewards reachable, recent, referred leads", () => {
  const referral = scoreLead({
    id: 1,
    companyName: "A",
    contactName: "Sam",
    contactEmail: "sam@a.example",
    source: "referral",
    stage: "new",
    score: 0,
    ageDays: 1,
    daysSinceLastTouch: 1,
    nextActionOverdueDays: null,
  });
  const cold = scoreLead({
    id: 2,
    companyName: "B",
    contactName: null,
    contactEmail: null,
    source: "import",
    stage: "new",
    score: 0,
    ageDays: 90,
    daysSinceLastTouch: null,
    nextActionOverdueDays: null,
  });
  assert.ok(referral.score > cold.score);
  assert.ok(referral.reasons.length > 0);
});

/* ————————————————————————— Governance ————————————————————————— */

test("governance pauses an agent that keeps failing", () => {
  const snapshot = emptySnapshot({
    fleet: [
      {
        agentKey: "growth-agent",
        domain: "growth",
        enabled: true,
        autonomy: "supervised",
        status: "error",
        healthScore: 0.2,
        actionsToday: 0,
        dailyActionBudget: 25,
        lastRunAt: "2026-01-15T11:00:00.000Z",
        minutesSinceLastRun: 60,
        lastError: "boom",
        failedRuns24h: 4,
        succeededRuns24h: 0,
      },
    ],
  });

  const output = runAgent(governanceAgent, contextFor(snapshot, governanceAgent.key)).output;
  const pause = output?.proposals.find((entry) => entry.kind === "governance.pause_unhealthy_agent");
  assert.ok(pause);
  assert.deepEqual(pause.effect, {
    type: "agent.pause",
    targetAgentKey: "growth-agent",
    note: "4 failed runs in 24h",
  });
});

test("governance narrows autonomy for an agent the operator keeps rejecting", () => {
  const snapshot = emptySnapshot({
    fleet: [
      {
        agentKey: "sales-agent",
        domain: "sales",
        enabled: true,
        autonomy: "autonomous",
        status: "idle",
        healthScore: 1,
        actionsToday: 0,
        dailyActionBudget: 25,
        lastRunAt: "2026-01-15T11:00:00.000Z",
        minutesSinceLastRun: 60,
        lastError: null,
        failedRuns24h: 0,
        succeededRuns24h: 4,
      },
    ],
    ledger: {
      openCount: 0,
      executed24h: 0,
      approved7d: 3,
      rejected7d: 7,
      stale: [],
      byAgent: [{ agentKey: "sales-agent", open: 0, executed7d: 3, rejected7d: 7 }],
    },
  });

  const output = runAgent(governanceAgent, contextFor(snapshot, governanceAgent.key)).output;
  const narrow = output?.proposals.find((entry) => entry.kind === "governance.reduce_autonomy");
  assert.ok(narrow);
  assert.equal(narrow.effect.type, "agent.setAutonomy");
  // And it is high risk, so it reaches a human rather than applying itself.
  assert.equal(effectRisk(narrow.effect), "high");
});

/* ————————————————————————— Orchestrator ————————————————————————— */

test("the tick plan runs repair before revenue and skips what is not due", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  const plan = planTick(
    [
      { agentKey: "growth-agent", enabled: true, nextRunAt: null, status: "idle" },
      { agentKey: "product-agent", enabled: true, nextRunAt: null, status: "idle" },
      { agentKey: "sales-agent", enabled: false, nextRunAt: null, status: "idle" },
      {
        agentKey: "finance-agent",
        enabled: true,
        nextRunAt: new Date("2026-01-15T18:00:00.000Z"),
        status: "idle",
      },
      { agentKey: "support-agent", enabled: true, nextRunAt: null, status: "running" },
    ],
    now,
  );

  assert.deepEqual(
    plan.due.map((entry) => entry.agentKey),
    ["product-agent", "growth-agent"],
  );
  assert.ok(plan.skipped.some((entry) => entry.agentKey === "sales-agent"));
  assert.ok(plan.skipped.some((entry) => entry.agentKey === "support-agent"));
});

test("a thrown agent is reported, never propagated", () => {
  const exploding = {
    ...AGENT_REGISTRY[0],
    key: "exploding-agent",
    run() {
      throw new Error("kaboom");
    },
  };
  const { output, error } = runAgent(exploding, contextFor(emptySnapshot(), "exploding-agent"));
  assert.equal(output, null);
  assert.match(error ?? "", /kaboom/);
});

test("the state of the business escalates to its worst observation", () => {
  const state = stateOfBusiness(emptySnapshot(), [
    { key: "a", label: "Failure rate", value: 0.4, severity: "critical" },
    { key: "b", label: "Open tickets", value: 3, severity: "warning" },
    { key: "c", label: "Venues", value: 2 },
  ]);
  assert.equal(state.severity, "critical");
  assert.equal(state.concerns.length, 2);
  assert.ok(state.narrative.length > 0);
});

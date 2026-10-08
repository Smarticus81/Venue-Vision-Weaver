import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const grok = await import("./grok.js");
const { AGENT_DEFINITIONS, AGENT_KEYS } = await import("./agents.js");
const { TOOL_NAMES } = await import("./tools.js");
const { ACTION_CATALOG, computeRequiresApproval, agentMayPropose, describeActionCatalog } = await import("./actions.js");
const { validatePolicyUpdate, POLICY_DEFAULTS } = await import("./policies.js");
const { listOrganizationsQuery, listVenuesQuery } = await import("./growth/queries.js");
const { classifyVenueType, normalizeRegion } = await import("./growth/segments.js");
const { computeEffectiveCap, shouldPauseOnEvent } = await import("./outreach/sendingHealth.js");

type FetchCall = { url: string; body: Record<string, unknown> };

function stubFetch(responses: Array<Record<string, unknown>>): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> });
    const payload = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

const originalFetch = globalThis.fetch;

test("control plane is unconfigured and fails safe without XAI_API_KEY", async () => {
  delete process.env.XAI_API_KEY;
  assert.equal(grok.controlPlaneAiConfigured(), false);
  assert.equal(grok.controlPlaneWebSearchEnabled(), false);
  await assert.rejects(
    grok.runAgentLoop({
      systemPrompt: "s",
      userMessage: "u",
      tools: [],
      executeTool: async () => null,
    }),
    /XAI_API_KEY/,
  );
});

test("model id comes from env with a grok default", () => {
  delete process.env.CONTROL_PLANE_MODEL;
  delete process.env.XAI_MODEL;
  assert.equal(grok.controlPlaneModel(), "grok-4.7");
  process.env.XAI_MODEL = "grok-4.5";
  assert.equal(grok.controlPlaneModel(), "grok-4.5");
  process.env.CONTROL_PLANE_MODEL = "grok-4.7-custom";
  assert.equal(grok.controlPlaneModel(), "grok-4.7-custom");
  delete process.env.CONTROL_PLANE_MODEL;
  delete process.env.XAI_MODEL;
});

test("agent loop executes function calls and returns tool outputs by call_id", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.XAI_API_KEY;
  });
  process.env.XAI_API_KEY = "xai-test-key";

  const { calls } = stubFetch([
    {
      id: "resp_1",
      output: [
        { type: "reasoning", id: "rs_1" },
        { type: "function_call", call_id: "call_a", name: "get_business_metrics", arguments: "{}" },
        {
          type: "function_call",
          call_id: "call_b",
          name: "list_prospects",
          arguments: '{"status":"qualified"}',
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    {
      id: "resp_2",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "All done. Pipeline looks healthy." }],
        },
      ],
      usage: { input_tokens: 50, output_tokens: 10 },
    },
  ]);

  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await grok.runAgentLoop({
    systemPrompt: "You are a test agent.",
    userMessage: "Run your review.",
    tools: [
      { name: "get_business_metrics", description: "KPIs" },
      { name: "list_prospects", description: "Pipeline", parameters: { type: "object", properties: {} } },
    ],
    executeTool: async (name, args) => {
      executed.push({ name, args });
      return { ok: true, name };
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /\/responses$/);
  assert.equal(calls[0]!.body.model, "grok-4.7");
  const firstInput = calls[0]!.body.input as Array<Record<string, unknown>>;
  assert.equal(firstInput[0]!.role, "system");
  assert.equal(firstInput[1]!.role, "user");
  const firstTools = calls[0]!.body.tools as Array<Record<string, unknown>>;
  assert.deepEqual(
    firstTools.map((tool) => tool.type),
    ["function", "function"],
  );
  assert.equal(firstTools[0]!.name, "get_business_metrics");

  // Second request continues the stored conversation and answers both calls.
  assert.equal(calls[1]!.body.previous_response_id, "resp_1");
  const secondInput = calls[1]!.body.input as Array<Record<string, unknown>>;
  assert.deepEqual(
    secondInput.map((item) => [item.type, item.call_id]),
    [
      ["function_call_output", "call_a"],
      ["function_call_output", "call_b"],
    ],
  );

  assert.deepEqual(executed, [
    { name: "get_business_metrics", args: {} },
    { name: "list_prospects", args: { status: "qualified" } },
  ]);
  assert.equal(result.finalText, "All done. Pipeline looks healthy.");
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.promptTokens, 150);
  assert.equal(result.completionTokens, 30);
});

test("malformed tool arguments are reported back instead of crashing the run", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.XAI_API_KEY;
  });
  process.env.XAI_API_KEY = "xai-test-key";

  const { calls } = stubFetch([
    {
      id: "resp_1",
      output: [
        { type: "function_call", call_id: "call_bad", name: "list_prospects", arguments: "{not json" },
      ],
    },
    {
      id: "resp_2",
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Recovered." }] },
      ],
    },
  ]);

  let executions = 0;
  const result = await grok.runAgentLoop({
    systemPrompt: "s",
    userMessage: "u",
    tools: [{ name: "list_prospects", description: "d" }],
    executeTool: async () => {
      executions += 1;
      return {};
    },
  });

  assert.equal(executions, 0, "malformed arguments must not reach the tool");
  const secondInput = calls[1]!.body.input as Array<Record<string, unknown>>;
  assert.match(String(secondInput[0]!.output), /not valid JSON/);
  assert.equal(result.finalText, "Recovered.");
  const errorStep = result.transcript.find((step) => step.type === "tool_result");
  assert.ok(errorStep && "error" in errorStep && errorStep.error);
});

test("server-side web search is only granted via the flag and lands in the transcript", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.XAI_API_KEY;
    delete process.env.CONTROL_PLANE_WEB_SEARCH;
  });
  process.env.XAI_API_KEY = "xai-test-key";

  const response = {
    id: "resp_1",
    output: [
      { type: "web_search_call", id: "ws_1", action: { query: "wedding venues austin" } },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Found venues." }] },
    ],
  };

  let stub = stubFetch([response]);
  const withSearch = await grok.runAgentLoop({
    systemPrompt: "s",
    userMessage: "u",
    tools: [{ name: "upsert_prospect", description: "d" }],
    enableWebSearch: true,
    executeTool: async () => ({}),
  });
  let tools = stub.calls[0]!.body.tools as Array<Record<string, unknown>>;
  assert.ok(tools.some((tool) => tool.type === "web_search"));
  assert.ok(
    withSearch.transcript.some((step) => step.type === "tool_call" && step.name === "web_search"),
  );

  stub = stubFetch([response]);
  await grok.runAgentLoop({
    systemPrompt: "s",
    userMessage: "u",
    tools: [{ name: "upsert_prospect", description: "d" }],
    executeTool: async () => ({}),
  });
  tools = stub.calls[0]!.body.tools as Array<Record<string, unknown>>;
  assert.ok(!tools.some((tool) => tool.type === "web_search"), "no web_search without the flag");

  process.env.CONTROL_PLANE_WEB_SEARCH = "off";
  stub = stubFetch([response]);
  await grok.runAgentLoop({
    systemPrompt: "s",
    userMessage: "u",
    tools: [{ name: "upsert_prospect", description: "d" }],
    enableWebSearch: true,
    executeTool: async () => ({}),
  });
  tools = stub.calls[0]!.body.tools as Array<Record<string, unknown>>;
  assert.ok(!tools.some((tool) => tool.type === "web_search"), "env kill switch wins over the flag");
});

test("registry: unique keys and every granted tool exists", () => {
  assert.equal(new Set(AGENT_KEYS).size, AGENT_DEFINITIONS.length);
  for (const agent of AGENT_DEFINITIONS) {
    assert.ok(agent.intervalMinutes > 0, `${agent.key} interval`);
    assert.ok(agent.mission.length > 200, `${agent.key} mission`);
    for (const tool of agent.tools) {
      assert.ok(TOOL_NAMES.includes(tool), `${agent.key} grants unknown tool "${tool}"`);
    }
  }
  for (const key of ["prospecting", "outreach", "campaigns"]) {
    assert.ok(AGENT_KEYS.includes(key), `revenue agent "${key}" must exist`);
  }
  // Step-0 registry seam: vetting + growth tools exist as stubs; the growth agent replaced experiments.
  for (const tool of ["vet_prospect", "get_growth_kpis", "get_growth_guidance", "evaluate_experiment", "list_experiments"]) {
    assert.ok(TOOL_NAMES.includes(tool), `tool "${tool}" must be registered`);
  }
  assert.ok(AGENT_KEYS.includes("growth"));
  assert.ok(!AGENT_KEYS.includes("experiments"));
  const prospecting = AGENT_DEFINITIONS.find((agent) => agent.key === "prospecting")!;
  assert.match(prospecting.mission, /Pass emailSourceUrl to upsert_prospect every time/);
  assert.match(prospecting.mission, /vet_prospect/);
  const outreach = AGENT_DEFINITIONS.find((agent) => agent.key === "outreach")!;
  assert.match(outreach.mission, /never propose send_prospect_email/);
  assert.match(outreach.mission, /vettingStatus=passed/);
  assert.match(AGENT_DEFINITIONS.find((agent) => agent.key === "governance")!.mission, /byVettingStatus/);
  // Every agent that may propose actions declares an allowlist of catalog types.
  for (const agent of AGENT_DEFINITIONS) {
    if (agent.tools.includes("propose_action")) {
      assert.ok(agent.actions && agent.actions.length > 0, `${agent.key} needs an actions allowlist`);
    }
    for (const actionType of agent.actions ?? []) {
      assert.ok(ACTION_CATALOG[actionType], `${agent.key} allows unknown action "${actionType}"`);
    }
  }
  assert.equal(agentMayPropose("prospecting", "send_venue_email").allowed, false);
  assert.equal(agentMayPropose("outreach", "send_outreach_email").allowed, true);
  assert.equal(agentMayPropose("outreach", "grant_promo_credits").allowed, false);
  assert.equal(agentMayPropose("operator", "send_outreach_email").allowed, true);
});

test("approval helper and catalog seam", () => {
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, true, false), false);
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, true, true), true);
  assert.equal(computeRequiresApproval({ riskLevel: "low" }, false, false), true);
  assert.equal(computeRequiresApproval({ riskLevel: "high" }, true, false), true);
  for (const entry of describeActionCatalog()) {
    assert.equal(typeof entry.retired, "boolean", `${entry.type} exposes retired`);
  }
});

test("policy edits are validated per key with bounds", () => {
  const keys = POLICY_DEFAULTS.map((policy) => policy.key);
  for (const key of [
    "agents_enabled",
    "outreach_sends_enabled",
    "max_daily_ai_usd",
    "max_campaign_steps",
    "vetting_pass_score",
    "deliverability_guard",
    "segment_guidance",
    "max_prospect_emails_per_day_base",
  ]) {
    assert.ok(keys.includes(key), `policy default "${key}"`);
  }
  assert.equal(new Set(keys).size, keys.length, "policy keys are unique");
  assert.deepEqual(validatePolicyUpdate("max_campaign_steps", { steps: 2 }), { ok: true, value: { steps: 2 } });
  assert.equal(validatePolicyUpdate("max_campaign_steps", { steps: 9 }).ok, false);
  assert.equal(validatePolicyUpdate("max_campaign_steps", { emails: 2 }).ok, false);
  assert.equal(validatePolicyUpdate("agents_enabled", { enabled: "yes" }).ok, false);
  assert.equal(validatePolicyUpdate("agents_enabled", { enabled: false }).ok, true);
  assert.equal(validatePolicyUpdate("vetting_blocked_countries", { codes: "CA, GB" }).ok, true);
  assert.equal(validatePolicyUpdate("vetting_blocked_countries", { codes: "Canada" }).ok, false);
  assert.equal(validatePolicyUpdate("deliverability_guard", { status: "ok" }).ok, false, "system-managed");
  assert.equal(validatePolicyUpdate("nope", { x: 1 }).ok, false);
});

test("growth seams: alias-qualified SQL, venue classifier, guard math", () => {
  const orgSql = listOrganizationsQuery(10).toSQL().sql;
  assert.match(orgSql, /v\.id = cs\.venue_id/);
  assert.doesNotMatch(orgSql, /"id" = "venue_id"|"venue_id" = "id"/);
  const venueSql = listVenuesQuery(10, "least_active").toSQL().sql;
  assert.match(venueSql, /vm\.venue_id = "venues"\."id"/);
  assert.match(venueSql, /cs2\.venue_id = "venues"\."id"/);

  assert.equal(classifyVenueType({ name: "Oak Hollow Barn" }), "barn_farm");
  assert.equal(classifyVenueType({ name: "The Grand Hotel" }), "hotel_resort");
  assert.equal(classifyVenueType({ name: "Loft 12", facts: { style: "industrial loft" } }), "urban_loft");
  assert.equal(classifyVenueType({ name: "Smith Events" }), "other");
  assert.equal(normalizeRegion("  austin,   tx "), "Austin, TX");
  assert.equal(normalizeRegion(null), "Unknown");

  assert.equal(computeEffectiveCap({ status: "paused" }, 15), 0);
  assert.equal(computeEffectiveCap({ status: "throttled" }, 15), 7);
  assert.equal(computeEffectiveCap({ status: "throttled" }, 4), 4);
  assert.equal(computeEffectiveCap({ status: "ok" }, 15), 15);
  const health = { windowDays: 14, sent: 25, bounced: 2, complained: 0, bounceRatePct: 8 };
  assert.match(shouldPauseOnEvent(health, "bounced") ?? "", /bounce rate 8\.0% \(2 of 25\) over 14 days/);
  assert.equal(shouldPauseOnEvent({ ...health, bounced: 1, bounceRatePct: 4 }, "bounced"), null);
  assert.equal(shouldPauseOnEvent({ ...health, bounced: 2, bounceRatePct: 3.9 }, "bounced"), null);
  assert.match(shouldPauseOnEvent({ ...health, complained: 1 }, "complained") ?? "", /1 spam complaint in 14 days/);
  assert.equal(shouldPauseOnEvent(health, "complained"), null);
});

test("safety model: external contact and spend always require operator approval", () => {
  const expectations: Record<string, "medium" | "high"> = {
    send_prospect_email: "high",
    send_outreach_email: "high",
    send_venue_email: "high",
    launch_campaign: "high",
    grant_promo_credits: "high",
    update_policy: "high",
    enroll_prospects_in_campaign: "medium",
    pause_campaign: "medium",
    complete_campaign: "medium",
    requeue_failed_session: "medium",
    pause_agent: "medium",
    resume_agent: "medium",
  };
  for (const [actionType, riskLevel] of Object.entries(expectations)) {
    const action = ACTION_CATALOG[actionType];
    assert.ok(action, `action "${actionType}" must exist`);
    assert.equal(action.riskLevel, riskLevel, `${actionType} risk level`);
  }
  // Only growth's lifecycle/digest emails may be low risk (and they gate on a policy flag);
  // nothing else in the catalog may auto-execute.
  const LOW_RISK_ALLOWED = new Set(["send_lifecycle_email", "send_operator_digest"]);
  for (const action of Object.values(ACTION_CATALOG)) {
    if (action.riskLevel === "low") {
      assert.ok(LOW_RISK_ALLOWED.has(action.type), `${action.type} must not be low risk`);
      assert.equal(typeof action.requiresApproval, "function", `${action.type} needs a requiresApproval gate`);
    }
  }
});

test("prospecting agent is research-only: no governed actions, no email tools", () => {
  const prospecting = AGENT_DEFINITIONS.find((agent) => agent.key === "prospecting");
  assert.ok(prospecting);
  assert.ok(!prospecting.tools.includes("propose_action"));
  assert.equal(prospecting.webSearch, true);
});

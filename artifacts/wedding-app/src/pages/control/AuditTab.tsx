import {
  useGetControlAudit,
  getGetControlAuditQueryKey,
  useListControlPolicies,
  getListControlPoliciesQueryKey,
} from "@workspace/api-client-react";
import { Card, EmptyState, TabLoading, fmt } from "./shared";

/* ————— Audit + policies ————— */

export function AuditTab() {
  const auditQuery = useGetControlAudit(
    {},
    { query: { queryKey: getGetControlAuditQueryKey(), refetchInterval: 30000 } },
  );
  const policiesQuery = useListControlPolicies({
    query: { queryKey: getListControlPoliciesQueryKey() },
  });
  const events = auditQuery.data?.events ?? [];
  const policies = policiesQuery.data?.policies ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Governance policies</h2>
        {policies.length === 0 ? (
          <EmptyState text="Policies are seeded when the control-plane worker first starts." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {policies.map((policy) => (
              <Card key={policy.id}>
                <p className="font-mono text-xs text-brand">{policy.key}</p>
                <p className="mt-1 font-mono text-xs text-foreground/85">
                  {JSON.stringify(policy.value)}
                </p>
                {policy.description ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {policy.description}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Audit trail</h2>
        {auditQuery.isLoading ? (
          <TabLoading />
        ) : events.length === 0 ? (
          <EmptyState text="Every agent proposal, operator decision, and execution is recorded here." />
        ) : (
          <Card className="p-0">
            <div className="max-h-[36rem] divide-y divide-border overflow-y-auto">
              {events.map((event) => (
                <div key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="mono-label w-32 shrink-0 text-muted-foreground">
                    {fmt(event.createdAt)}
                  </span>
                  <span className="mono-label text-brand">{event.actorType}:{event.actor}</span>
                  <span className="text-xs font-medium text-foreground/90">
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  {event.subjectType ? (
                    <span className="mono-label text-muted-foreground">
                      {event.subjectType} {event.subjectId}
                    </span>
                  ) : null}
                  {event.detail ? (
                    <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(event.detail).slice(0, 220)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

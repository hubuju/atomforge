import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Code2,
  Compass,
  Loader2,
  MinusCircle,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { formatMs, type Lane, type LaneStatus } from '@/lib/orchestrator';
import { ROLE_META } from '@/lib/roles';
import type { RoleId } from '@/lib/settings';

const ROLE_ICON: Record<RoleId, typeof Compass> = {
  planner: Compass,
  coder: Code2,
  reviewer: ShieldCheck,
  fixer: Wrench,
};

function StatusMark({ status }: { status: LaneStatus }) {
  if (status === 'active') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === 'done') return <Check className="tone-ok h-3.5 w-3.5" />;
  if (status === 'failed') return <TriangleAlert className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'skipped') return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

/**
 * Role swimlanes.
 *
 * Instead of one opaque spinner, each of the four agents gets its own lane
 * showing the model it ran on, what it is doing right now, how long it took and
 * how much it produced. Expanding a lane reveals the digest of what it received
 * and what it handed to the next role — the blackboard, made visible.
 */
export function RoleLanes({ lanes, title }: { lanes: Lane[]; title?: string }) {
  const [open, setOpen] = useState<RoleId | null>(null);

  const settled = lanes.filter(
    (lane) => lane.status === 'done' || lane.status === 'skipped',
  ).length;
  const active = lanes.find((lane) => lane.status === 'active');
  const failed = lanes.find((lane) => lane.status === 'failed');
  const progress = Math.round((settled / lanes.length) * 100);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-2">
        {failed ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : active ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <ShieldCheck className="tone-ok h-3.5 w-3.5 shrink-0" />
        )}
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {failed
            ? `${ROLE_META[failed.role].name}中断：${failed.detail}`
            : active
              ? `${ROLE_META[active.role].name} · ${active.detail}`
              : title || '流水线已完成'}
        </p>
        <span className="nums-tabular shrink-0 font-code text-[10.5px] text-muted-foreground">
          {settled}/{lanes.length}
        </span>
      </div>

      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ease-out-quart duration-500 ${
            failed ? 'bg-destructive' : 'bg-primary'
          }`}
          style={{ width: `${failed ? 100 : progress}%` }}
        />
      </div>

      <ol className="mt-3 space-y-0.5">
        {lanes.map((lane, index) => {
          const meta = ROLE_META[lane.role];
          const Icon = ROLE_ICON[lane.role];
          const expandable = Boolean(lane.input || lane.output);
          const expanded = open === lane.role;

          return (
            <li key={lane.role} className="relative pl-[19px]">
              {/* connector rail between lanes */}
              {index < lanes.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute left-[6px] top-[22px] h-[calc(100%-14px)] w-px bg-border"
                />
              ) : null}
              <span aria-hidden className="absolute left-0 top-[7px]">
                <StatusMark status={lane.status} />
              </span>

              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpen(expanded ? null : lane.role)}
                className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ease-out-quart duration-200 ${
                  expandable ? 'hover:md:bg-secondary/60' : 'cursor-default'
                }`}
              >
                <Icon
                  className={`h-3 w-3 shrink-0 ${
                    lane.status === 'idle' ? 'text-muted-foreground/50' : 'text-primary'
                  }`}
                />
                <span
                  className={`shrink-0 text-[11.5px] font-medium ${
                    lane.status === 'idle' ? 'text-muted-foreground/60' : 'text-foreground'
                  }`}
                >
                  {meta.name}
                </span>
                <span className="min-w-0 flex-1 truncate font-code text-[10.5px] text-muted-foreground">
                  {lane.detail}
                </span>
                {lane.chars > 0 ? (
                  <span className="nums-tabular shrink-0 font-code text-[10px] text-muted-foreground/80">
                    {lane.chars > 999 ? `${(lane.chars / 1000).toFixed(1)}k` : lane.chars}
                  </span>
                ) : null}
                {lane.ms > 0 ? (
                  <span className="nums-tabular shrink-0 font-code text-[10px] text-muted-foreground/80">
                    {formatMs(lane.ms)}
                  </span>
                ) : null}
                {expandable ? (
                  expanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )
                ) : null}
              </button>

              {expanded ? (
                <div className="mb-1 ml-1.5 space-y-1.5 rounded-lg border border-border bg-background/60 p-2">
                  <p className="text-[10px] text-muted-foreground">
                    {meta.duty} · 模型 <span className="font-code text-foreground">{lane.model}</span>
                  </p>
                  {lane.input ? (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">收到</p>
                      <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-code text-[10px] leading-relaxed text-muted-foreground/90">
                        {lane.input}
                      </pre>
                    </div>
                  ) : null}
                  {lane.output ? (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground">交出</p>
                      <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-code text-[10px] leading-relaxed text-muted-foreground/90">
                        {lane.output}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
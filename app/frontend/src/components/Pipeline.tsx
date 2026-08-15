import { Check, CircleDashed, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Stage } from '@/lib/agent';

export type StageState = 'idle' | 'active' | 'done' | 'failed';

export interface StageInfo {
  id: Stage;
  label: string;
  /** What is actually happening right now, e.g. the file being written. */
  detail: string;
  state: StageState;
}

/**
 * Build-pipeline strip.
 *
 * Rather than dressing the model up as a fake team of colleagues, this exposes
 * the four real stages the product actually runs: read the brief, write files,
 * self-check, render. Each stage reports its own live detail line, so the wait
 * is legible instead of a spinner.
 */
export function Pipeline({ stages }: { stages: StageInfo[] }) {
  const activeIndex = stages.findIndex((stage) => stage.state === 'active');
  const active = activeIndex >= 0 ? stages[activeIndex] : null;
  const failed = stages.find((stage) => stage.state === 'failed');
  const doneCount = stages.filter((stage) => stage.state === 'done').length;
  const progress = Math.round((doneCount / stages.length) * 100);

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
            ? `${failed.label}阶段没通过`
            : active
              ? `${active.label} · ${active.detail}`
              : '流水线已完成'}
        </p>
        <span className="nums-tabular shrink-0 font-code text-[10.5px] text-muted-foreground">
          {doneCount}/{stages.length}
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

      <ol className="mt-3 space-y-1.5">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-start gap-2">
            <span className="mt-px shrink-0">
              {stage.state === 'done' ? (
                <Check className="tone-ok h-3.5 w-3.5" />
              ) : stage.state === 'active' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : stage.state === 'failed' ? (
                <TriangleAlert className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5 text-muted-foreground/50" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`text-[11.5px] font-medium ${
                  stage.state === 'idle' ? 'text-muted-foreground/60' : 'text-foreground'
                }`}
              >
                {stage.label}
              </span>
              <span className="ml-1.5 break-words font-code text-[10.5px] text-muted-foreground">
                {stage.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
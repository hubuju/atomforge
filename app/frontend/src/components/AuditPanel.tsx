import { Check, Loader2, ShieldCheck, TriangleAlert, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AuditResult } from '@/lib/audit';

interface AuditPanelProps {
  result: AuditResult;
  /** True while the runtime pass is still waiting on the sandbox report. */
  pending: boolean;
  busy: boolean;
  onFix: () => void;
  onDismiss: () => void;
}

const LEVEL_STYLE = {
  pass: 'tone-ok',
  warn: 'tone-warn',
  error: 'text-destructive',
} as const;

/**
 * Self-check report. It is deliberately shown before the user starts clicking,
 * so basic defects (blank page, dead buttons, truncated script) are surfaced by
 * the product rather than discovered by the person using it.
 */
export function AuditPanel({ result, pending, busy, onFix, onDismiss }: AuditPanelProps) {
  if (!result.checks.length && !pending) return null;

  const blocking = result.errors.length > 0;
  const warned = !blocking && result.warnings.length > 0;

  return (
    <div
      className={`shrink-0 border-b px-3 py-2 ${
        blocking
          ? 'border-destructive/30 bg-destructive/10'
          : warned
            ? 'chip-warn'
            : 'border-border bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2">
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : blocking ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
        ) : warned ? (
          <TriangleAlert className="tone-warn h-3.5 w-3.5 shrink-0" />
        ) : (
          <ShieldCheck className="tone-ok h-3.5 w-3.5 shrink-0" />
        )}

        <p className="min-w-0 flex-1 text-[12px] font-medium">
          {pending
            ? '正在自检运行结果…'
            : blocking
              ? `自检发现 ${result.errors.length} 个阻塞问题`
              : warned
                ? `基础功能正常，有 ${result.warnings.length} 处可以更好`
                : '自检通过，页面能渲染且控件已绑定'}
        </p>

        {!pending && blocking ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1 !bg-transparent hover:!bg-transparent"
            disabled={busy}
            onClick={onFix}
          >
            <Wrench className="h-3 w-3" />
            让 AI 修
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="收起自检结果"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {result.checks.length ? (
        <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {result.checks
            .slice()
            .sort((a, b) => {
              const rank = { error: 0, warn: 1, pass: 2 } as const;
              return rank[a.level] - rank[b.level];
            })
            .map((check) => (
              <li key={check.id} className="flex items-start gap-1.5">
                {check.level === 'pass' ? (
                  <Check className={`mt-0.5 h-3 w-3 shrink-0 ${LEVEL_STYLE.pass}`} />
                ) : (
                  <TriangleAlert className={`mt-0.5 h-3 w-3 shrink-0 ${LEVEL_STYLE[check.level]}`} />
                )}
                <span className="min-w-0 text-[11px] leading-snug">
                  <span className="font-medium">{check.label}</span>
                  <span className="ml-1 break-words text-muted-foreground">{check.detail}</span>
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
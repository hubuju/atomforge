/**
 * Template picker — both built-in starters (T1) and personal templates (T5).
 *
 * Two entry points share this component:
 *  - the project create dialog, where picking a template skips generation
 *    entirely and hands over a working project instantly;
 *  - the workspace, where a brief that clearly matches a known app shape
 *    surfaces a "use the template instead?" suggestion.
 *
 * The suggestion is never applied automatically. Being forced into the wrong
 * shape is far more frustrating than waiting for a real generation, so the
 * user always confirms.
 */
import { useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STARTER_TEMPLATES, type StarterTemplate } from '@/lib/templates';
import type { ProjectFile, TemplateRecord } from '@/lib/client';

export interface TemplateChoice {
  /** Human label used in the confirmation copy and version note. */
  label: string;
  files: ProjectFile[];
  /** Set when the pick came from the user's own saved templates. */
  personalId?: number;
}

interface TemplatePickerProps {
  personal: TemplateRecord[];
  personalLoading?: boolean;
  selectedId: string;
  onSelect: (id: string, choice: TemplateChoice | null) => void;
  onDeletePersonal?: (id: number) => void;
  /** Highlighted built-in id when a brief matched something. */
  suggestedId?: string;
}

function Card({
  active,
  suggested,
  title,
  summary,
  meta,
  highlights,
  onClick,
  onDelete,
}: {
  active: boolean;
  suggested?: boolean;
  title: string;
  summary: string;
  meta: string;
  highlights?: string[];
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`relative rounded-xl border p-3.5 transition-colors duration-200 ${
        active
          ? 'border-primary/70 bg-primary/[0.07]'
          : 'border-border/70 bg-card/40 hover:border-border'
      }`}
    >
      <button type="button" onClick={onClick} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {active ? (
            <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
          ) : suggested ? (
            <span className="flex-none rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-medium text-primary">
              推荐
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{summary}</p>
        {highlights?.length ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {highlights.map((item) => (
              <li
                key={item}
                className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2.5 text-[10.5px] uppercase tracking-wide text-muted-foreground/70">
          {meta}
        </p>
      </button>

      {onDelete ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onDelete}
          className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label="删除这个模板"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function TemplatePicker({
  personal,
  personalLoading,
  selectedId,
  onSelect,
  onDeletePersonal,
  suggestedId,
}: TemplatePickerProps) {
  const [tab, setTab] = useState<'builtin' | 'mine'>('builtin');

  const grouped = useMemo(() => {
    const map = new Map<string, StarterTemplate[]>();
    STARTER_TEMPLATES.forEach((template) => {
      const list = map.get(template.category) || [];
      list.push(template);
      map.set(template.category, list);
    });
    return Array.from(map.entries());
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab('builtin')}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            tab === 'builtin'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          内置模板 {STARTER_TEMPLATES.length}
        </button>
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            tab === 'mine'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          我的模板 {personal.length}
        </button>
        <button
          type="button"
          onClick={() => onSelect('', null)}
          className={`ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
            selectedId === ''
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Wand2 className="h-3.5 w-3.5" />
          让 AI 从零写
        </button>
      </div>

      <ScrollArea className="h-[268px] pr-2.5">
        {tab === 'builtin' ? (
          <div className="space-y-4">
            {grouped.map(([category, list]) => (
              <div key={category} className="space-y-2">
                <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {category}
                </p>
                <div className="grid gap-2">
                  {list.map((template) => (
                    <Card
                      key={template.id}
                      active={selectedId === template.id}
                      suggested={suggestedId === template.id}
                      title={template.name}
                      summary={template.summary}
                      highlights={template.highlights}
                      meta={`${template.files.length} 个文件 · 秒出，不消耗模型额度`}
                      onClick={() =>
                        onSelect(template.id, {
                          label: template.name,
                          files: template.files.map((file) => ({
                            path: file.path,
                            content: file.content,
                          })),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : personalLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取你的模板…
          </div>
        ) : personal.length ? (
          <div className="grid gap-2">
            {personal.map((item) => (
              <Card
                key={item.id}
                active={selectedId === `mine-${item.id}`}
                title={item.name}
                summary={item.description || '（没有写说明）'}
                meta={`${item.files?.length || 0} 个文件 · 已用 ${item.use_count || 0} 次`}
                onClick={() =>
                  onSelect(`mine-${item.id}`, {
                    label: item.name,
                    personalId: item.id,
                    files: (item.files || []).map((file) => ({
                      path: file.path,
                      content: file.content,
                    })),
                  })
                }
                onDelete={onDeletePersonal ? () => onDeletePersonal(item.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            <Sparkles className="h-5 w-5 text-muted-foreground/60" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              还没有自己的模板。在任意项目的工作台里点「存为模板」，
              下次就能直接基于它新建。
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
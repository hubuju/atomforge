import { useEffect, useState } from 'react';
import {
  Boxes,
  Compass,
  Database,
  FileCode2,
  Layout,
  MousePointerClick,
  Pencil,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectSpec } from '@/lib/roles';

interface SpecPanelProps {
  spec: ProjectSpec;
  busy: boolean;
  onConfirm: (spec: ProjectSpec) => void;
  onCancel: () => void;
}

/** Convert a list to editable text and back, dropping blank lines. */
function toText(items: string[]): string {
  return items.join('\n');
}

function fromText(text: string, limit: number): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-•\s]+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, limit);
}

function cleanPath(raw: string): string {
  return raw.trim().replace(/^\.\//, '').replace(/^\/+/, '').replace(/\s+/g, '');
}

/**
 * Spec review gate.
 *
 * The Planner stops here so the person who wrote the brief can correct the plan
 * *before* any code exists — fixing a wrong line in the spec costs one edit,
 * fixing it after the Coder wrote six files costs a whole round.
 */
export function SpecPanel({ spec, busy, onConfirm, onCancel }: SpecPanelProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(spec.title);
  const [summary, setSummary] = useState(spec.summary);
  const [views, setViews] = useState(toText(spec.views));
  const [data, setData] = useState(toText(spec.data));
  const [interactions, setInteractions] = useState(toText(spec.interactions));
  const [files, setFiles] = useState(
    spec.files.map((file) => `${file.path} | ${file.purpose}`).join('\n'),
  );

  // Re-seed whenever the Planner produces a new spec.
  useEffect(() => {
    setEditing(false);
    setTitle(spec.title);
    setSummary(spec.summary);
    setViews(toText(spec.views));
    setData(toText(spec.data));
    setInteractions(toText(spec.interactions));
    setFiles(spec.files.map((file) => `${file.path} | ${file.purpose}`).join('\n'));
  }, [spec]);

  const collect = (): ProjectSpec => {
    const parsedFiles = files
      .split('\n')
      .map((line) => {
        const [rawPath, ...rest] = line.split('|');
        return { path: cleanPath(rawPath || ''), purpose: rest.join('|').trim() };
      })
      .filter((file) => file.path.length > 0);

    return {
      title: title.trim() || spec.title,
      summary: summary.trim() || spec.summary,
      views: fromText(views, 8),
      data: fromText(data, 6),
      interactions: fromText(interactions, 10),
      files: parsedFiles.length ? parsedFiles : spec.files,
    };
  };

  const blocks: { key: string; icon: typeof Layout; label: string; items: string[] }[] = [
    { key: 'views', icon: Layout, label: '界面区块', items: spec.views },
    { key: 'data', icon: Database, label: '数据结构', items: spec.data },
    { key: 'interactions', icon: MousePointerClick, label: '交互清单', items: spec.interactions },
  ];

  return (
    <div className="rounded-xl border border-primary/35 bg-primary/[0.06] p-3">
      <div className="flex items-center gap-2">
        <Compass className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-[12px] font-medium">
          规划者给出了规格，确认后实现者才会开始写代码
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label={editing ? '退出编辑' : '编辑规格'}
          onClick={() => setEditing((prev) => !prev)}
          disabled={busy}
        >
          {editing ? <RotateCcw className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </Button>
      </div>

      {editing ? (
        <div className="mt-2.5 space-y-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="项目名称"
            className="h-8 text-[12.5px]"
          />
          <Textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={2}
            placeholder="一句话定位"
            className="resize-none text-[12px] leading-relaxed"
          />
          {[
            { label: '界面区块（每行一条）', value: views, set: setViews, rows: 3 },
            { label: '数据结构（每行一条）', value: data, set: setData, rows: 2 },
            { label: '交互清单（每行一条）', value: interactions, set: setInteractions, rows: 4 },
            { label: '文件划分（路径 | 职责）', value: files, set: setFiles, rows: 3 },
          ].map((field) => (
            <div key={field.label}>
              <p className="mb-1 text-[10.5px] text-muted-foreground">{field.label}</p>
              <Textarea
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                rows={field.rows}
                className="resize-none font-code text-[11.5px] leading-relaxed"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          <div>
            <p className="text-[12.5px] font-semibold">{spec.title}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {spec.summary}
            </p>
          </div>

          {blocks
            .filter((block) => block.items.length > 0)
            .map((block) => (
              <div key={block.key}>
                <p className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
                  <block.icon className="h-3 w-3 text-primary" />
                  {block.label}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {block.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground"
                    >
                      <span className="text-primary/70">·</span>
                      <span className="min-w-0 break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          <div>
            <p className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
              <Boxes className="h-3 w-3 text-primary" />
              文件划分
            </p>
            <ul className="mt-1 space-y-0.5">
              {spec.files.map((file) => (
                <li key={file.path} className="flex items-start gap-1.5 text-[11.5px] leading-snug">
                  <FileCode2 className="ink-js mt-0.5 h-3 w-3 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-code text-foreground">{file.path}</span>
                    <span className="ml-1 break-words text-muted-foreground">{file.purpose}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-primary/20 pt-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={onCancel}
          disabled={busy}
        >
          <X className="h-3 w-3" />
          放弃这轮
        </Button>
        <Button
          size="sm"
          className="ml-auto h-7 gap-1.5 px-2.5 text-[11.5px]"
          onClick={() => onConfirm(collect())}
          disabled={busy}
        >
          <Play className="h-3 w-3" />
          {editing ? '按修改后的规格开工' : '确认，开始实现'}
        </Button>
      </div>
    </div>
  );
}
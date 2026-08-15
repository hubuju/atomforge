import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, FileCode2, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLink, StatePanel } from '@/components/AppShell';
import { buildPreview } from '@/lib/agent';
import { errorText, formatTime, type ProjectFile } from '@/lib/client';
import { http } from '@/lib/http';

interface SharedWorkspace {
  id: number;
  name: string;
  description?: string;
  files: ProjectFile[];
  updated_at?: string;
}

/**
 * Public read-only runner. Fetched through the unauthenticated share route so
 * visitors without an account can still run a published project.
 */
export default function Share() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<SharedWorkspace | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    if (!slug) {
      setMessage('缺少分享标识');
      setState('error');
      return;
    }
    http<SharedWorkspace>(`/api/v1/share/${slug}`, { method: 'GET' })
      .then((data) => {
        if (!alive) return;
        if (!data?.files?.length) {
          setMessage('该应用还没有生成任何内容');
          setState('error');
          return;
        }
        setData(data);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setMessage(errorText(error, '该应用不存在或尚未公开发布'));
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  const srcDoc = useMemo(() => (data ? buildPreview(data.files) : ''), [data]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/70 px-4 backdrop-blur-sm">
        <BrandLink />
        {data ? (
          <>
            <span className="text-muted-foreground/40">/</span>
            <span className="max-w-[220px] truncate text-[13px] font-medium">{data.name}</span>
            <span className="hidden items-center gap-1 rounded border border-border bg-secondary px-1.5 py-px font-code text-[10.5px] text-muted-foreground sm:inline-flex">
              <FileCode2 className="h-3 w-3" />
              {data.files.length} 个文件
            </span>
            {data.updated_at ? (
              <span className="nums-tabular hidden text-[11px] text-muted-foreground md:inline">
                更新于 {formatTime(data.updated_at)}
              </span>
            ) : null}
          </>
        ) : null}
        <Button size="sm" className="ml-auto h-8 gap-1.5" asChild>
          <Link to="/auth">
            自己做一个
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </header>

      <main className="min-h-0 flex-1">
        {state === 'loading' ? (
          <div className="grid h-full place-items-center">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在载入这个应用…
            </span>
          </div>
        ) : state === 'error' ? (
          <StatePanel
            tone="danger"
            icon={<TriangleAlert className="h-5 w-5" />}
            title="打不开这个分享"
            description={message}
            action={
              <Button asChild>
                <Link to="/auth">去 AtomForge 做一个</Link>
              </Button>
            }
          />
        ) : (
          <iframe
            title={data?.name || '公开应用'}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </main>
    </div>
  );
}
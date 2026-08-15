import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  FileCode2,
  FolderPlus,
  Globe,
  LayoutTemplate,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { StatePanel, TopBar } from '@/components/AppShell';
import { GUIDE_STEPS, PROMPT_TIPS, STARTER_IDEAS } from '@/lib/agent';
import { SettingsDialog } from '@/components/SettingsDialog';
import {
  ATOMS_MODELS,
  loadSettings,
  saveSettings,
  settingsLabel,
  settingsTagline,
  type ModelSettings,
} from '@/lib/settings';
import { TemplatePicker, type TemplateChoice } from '@/components/TemplatePicker';
import { bestTemplateMatch, templateFiles } from '@/lib/templates';
import {
  api,
  errorText,
  formatTime,
  useSession,
  type TemplateRecord,
  type WorkspaceRecord,
} from '@/lib/client';

/** Sort options for the project grid. Recency first — that's what people want. */
const SORT_OPTIONS = [
  { id: 'updated', label: '最近更新' },
  { id: 'created', label: '最近创建' },
  { id: 'name', label: '名称 A→Z' },
  { id: 'versions', label: '迭代次数' },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]['id'];
type FilterKey = 'all' | 'published' | 'draft';

const FILTER_OPTIONS: Array<{ id: FilterKey; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'published', label: '已发布' },
  { id: 'draft', label: '未发布' },
];

/**
 * Home surface — the workspace hub itself, not a marketing page. Anonymous
 * visitors are routed to /auth to register or sign in.
 */
export default function Index() {
  const session = useSession();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ready = session.status === 'authenticated';

  const [projects, setProjects] = useState<WorkspaceRecord[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBrief, setNewBrief] = useState('');
  const [creating, setCreating] = useState(false);

  const [renameTarget, setRenameTarget] = useState<WorkspaceRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [settings, setSettings] = useState<ModelSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [filterKey, setFilterKey] = useState<FilterKey>('all');

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice | null>(null);

  const placeholderIdea = useMemo(
    () => STARTER_IDEAS[Math.floor(Math.random() * STARTER_IDEAS.length)],
    [],
  );

  /**
   * Suggest a built-in starter when the brief clearly describes one of them.
   * Requires at least two pieces of evidence — one incidental keyword is not
   * enough to nudge someone away from the generation they actually asked for.
   */
  const suggestion = useMemo(() => {
    if (templateChoice) return null;
    const match = bestTemplateMatch(newBrief);
    return match && match.score >= 2 ? match : null;
  }, [newBrief, templateChoice]);

  const loadProjects = useCallback(async () => {
    setListState('loading');
    try {
      setProjects(await api.listWorkspaces());
      setListState('ready');
    } catch (error) {
      setListError(errorText(error, '项目列表加载失败'));
      setListState('error');
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      setTemplates(await api.listTemplates());
    } catch {
      // Personal templates are a convenience, not a blocker for the page.
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      void loadProjects();
      void loadTemplates();
    }
  }, [ready, loadProjects, loadTemplates]);

  /** Search + filter + sort applied client-side; the list is small by nature. */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = projects.filter((project) => {
      if (filterKey === 'published' && !project.is_published) return false;
      if (filterKey === 'draft' && project.is_published) return false;
      if (!needle) return true;
      return (
        project.name.toLowerCase().includes(needle) ||
        (project.description || '').toLowerCase().includes(needle)
      );
    });

    const stamp = (value?: string) => (value ? new Date(value).getTime() : 0);
    return rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
      if (sortKey === 'versions') return (b.version_count || 0) - (a.version_count || 0);
      if (sortKey === 'created') return stamp(b.created_at) - stamp(a.created_at);
      return stamp(b.updated_at || b.created_at) - stamp(a.updated_at || a.created_at);
    });
  }, [projects, query, filterKey, sortKey]);

  const handleDeleteTemplate = async (id: number) => {
    try {
      await api.deleteTemplate(id);
      setTemplates((prev) => prev.filter((item) => item.id !== id));
      if (templateId === `mine-${id}`) {
        setTemplateId('');
        setTemplateChoice(null);
      }
      toast({ title: '项目已删除' });
    } catch (error) {
      toast({ title: '删除项目失败', description: errorText(error), variant: 'destructive' });
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: '请先给项目起个名字', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const brief = newBrief.trim();
      const picked = templateChoice;
      const created = await api.createWorkspace({
        name,
        description: brief,
        files: picked ? picked.files : undefined,
      });

      // A template pick means the project already has runnable code, so the
      // workspace must NOT immediately fire a generation with the brief.
      if (picked) {
        await api.createVersion({
          workspace_id: created.id,
          version_no: 1,
          files: picked.files,
          summary: `基于项目「${picked.label}」创建`,
          note: '初始版本',
          keep_limit: settings.versionKeep,
          audit: '',
        });
        await api.updateWorkspace(created.id, { version_count: 1 });
        if (picked.personalId) {
          void api.useTemplate(picked.personalId).catch(() => undefined);
        }
      }

      setCreateOpen(false);
      setNewName('');
      setNewBrief('');
      setTemplateId('');
      setTemplateChoice(null);
      navigate(`/w/${created.id}`, {
        // With a template the brief is a follow-up edit, not a cold start — the
        // workspace prefills it instead of firing a generation immediately.
        state: picked
          ? { fromTemplate: picked.label, pendingBrief: brief }
          : brief
            ? { brief }
            : undefined,
      });
    } catch (error) {
      toast({ title: '创建失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      toast({ title: '名称不能为空', variant: 'destructive' });
      return;
    }
    setRenaming(true);
    try {
      await api.updateWorkspace(renameTarget.id, { name });
      setProjects((prev) =>
        prev.map((item) => (item.id === renameTarget.id ? { ...item, name } : item)),
      );
      setRenameTarget(null);
      toast({ title: '名称已更新' });
    } catch (error) {
      toast({ title: '重命名失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteWorkspace(deleteTarget.id);
      setProjects((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast({ title: '项目已删除' });
    } catch (error) {
      toast({ title: '删除失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  if (session.status === 'anonymous') {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar session={session}>
        {ready ? (
          <>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setGuideOpen(true)}>
              <Lightbulb className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline">怎么用</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{settingsLabel(settings)}</span>
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="h-3.5 w-3.5" />
              新建项目
            </Button>
          </>
        ) : null}
      </TopBar>

      <main className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        {session.status === 'loading' ? (
          <div className="space-y-6">
            <Skeleton className="h-9 w-52" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-36 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-7">
              <h1 className="text-3xl font-bold tracking-tight">工作区</h1>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                用一句话描述需求，智能体按 index.html / styles.css / app.js 逐个文件写出代码，并在沙箱里立刻运行。
                {listState === 'ready' ? ` 当前共 ${projects.length} 个项目。` : ''}
              </p>
            </div>

            {listState === 'ready' && projects.length > 0 ? (
              <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="relative sm:max-w-xs sm:flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索项目名称或描述"
                    className="h-9 pl-8"
                    aria-label="搜索项目"
                  />
                </div>

                <div className="flex items-center gap-1 rounded-lg border border-border bg-card/50 p-0.5">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFilterKey(option.id)}
                      className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ease-out-quart duration-200 ${
                        filterKey === option.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:md:text-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 !bg-transparent hover:!bg-transparent sm:ml-auto"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                      {SORT_OPTIONS.find((option) => option.id === sortKey)?.label}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    {SORT_OPTIONS.map((option) => (
                      <DropdownMenuItem key={option.id} onClick={() => setSortKey(option.id)}>
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}

            {listState === 'loading' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} className="h-36 w-full rounded-xl" />
                ))}
              </div>
            ) : listState === 'error' ? (
              <StatePanel
                tone="danger"
                icon={<TriangleAlert className="h-5 w-5" />}
                title="项目列表没能加载出来"
                description={listError}
                action={
                  <Button
                    variant="outline"
                    className="!bg-transparent hover:!bg-transparent"
                    onClick={() => void loadProjects()}
                  >
                    重新加载
                  </Button>
                }
              />
            ) : projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg border border-border bg-secondary text-primary">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">还没有项目</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  新建一个项目，然后告诉智能体你想要什么 —— 比如「{placeholderIdea}」。
                  生成的应用会立刻在右侧跑起来。
                </p>
                <Button className="mt-6 gap-1.5" onClick={() => setCreateOpen(true)}>
                  <FolderPlus className="h-4 w-4" />
                  创建第一个项目
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground">
                  <Search className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">没有匹配的项目</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  换个关键词，或者把筛选条件放宽一点。
                </p>
                <Button
                  variant="outline"
                  className="mt-6 !bg-transparent hover:!bg-transparent"
                  onClick={() => {
                    setQuery('');
                    setFilterKey('all');
                  }}
                >
                  清空筛选
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((project) => (
                  <article
                    key={project.id}
                    className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors ease-out-quart duration-200 hover:md:border-primary/40"
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/w/${project.id}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <h3 className="truncate font-display text-base font-semibold">{project.name}</h3>
                        <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-[13px] leading-relaxed text-muted-foreground">
                          {project.description?.trim() || '还没有描述，进入后告诉智能体你想做什么。'}
                        </p>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label={`${project.name} 的更多操作`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(project);
                              setRenameValue(project.name);
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(project)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            删除项目
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-4 flex items-center gap-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
                      <span className="nums-tabular font-code">v{project.version_count || 0}</span>
                      <span className="inline-flex items-center gap-1 nums-tabular">
                        <FileCode2 className="h-3 w-3" />
                        {project.files?.length || 0} 个文件
                      </span>
                      {project.is_published ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Globe className="h-3 w-3" />
                          已发布
                        </span>
                      ) : null}
                      <span className="nums-tabular ml-auto">
                        {formatTime(project.updated_at || project.created_at)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Create */}
      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          // Refresh on open so a template just saved from a workspace shows up
          // without needing a full page reload.
          if (next) void loadTemplates();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[86vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              给它起个名字，选择从内置项目起步还是让 AI 从零写，然后写下你的需求。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="project-name">项目名称</Label>
              <Input
                id="project-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="例如：番茄钟计时器"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <LayoutTemplate className="h-3.5 w-3.5 text-primary" />
                从哪里开始
              </Label>
              <TemplatePicker
                personal={templates}
                personalLoading={templatesLoading}
                selectedId={templateId}
                suggestedId={suggestion?.template.id}
                onSelect={(id, choice) => {
                  setTemplateId(id);
                  setTemplateChoice(choice);
                }}
                onDeletePersonal={(id) => void handleDeleteTemplate(id)}
              />
              {suggestion ? (
                <div className="rounded-lg border border-primary/30 bg-primary/[0.07] p-2.5">
                  <p className="text-[11.5px] leading-snug text-foreground">
                    你的需求看起来就是「{suggestion.template.name}」。直接用这个内置项目可以省一轮生成，
                    进去之后照样能继续改。
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 !bg-transparent px-2 text-[11.5px] hover:!bg-transparent"
                    onClick={() => {
                      setTemplateId(suggestion.template.id);
                      setTemplateChoice({
                        label: suggestion.template.name,
                        files: templateFiles(suggestion.template),
                      });
                    }}
                  >
                    就用这个项目
                  </Button>
                </div>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                {templateChoice
                  ? `选了「${templateChoice.label}」：进入工作台后代码已经能跑，直接说需求就能继续改。`
                  : '选「让 AI 从零写」则由四角色流水线按你的需求现写。'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-brief">
                {templateChoice ? '想在这个项目上改什么（可选）' : '首轮需求（可选）'}
              </Label>
              <Textarea
                id="project-brief"
                value={newBrief}
                onChange={(event) => setNewBrief(event.target.value)}
                placeholder={placeholderIdea}
                rows={4}
                className="resize-none leading-relaxed"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {STARTER_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setNewBrief(idea)}
                    className="rounded-md border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors ease-out-quart duration-200 hover:md:border-primary/40 hover:md:text-foreground"
                  >
                    {idea.slice(0, 12)}…
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>生成模型</Label>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-transparent px-3 text-left transition-colors ease-out-quart duration-200 hover:md:border-primary/40"
              >
                <span className="truncate text-[13px] font-medium">{settingsLabel(settings)}</span>
                <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 py-px text-[10px] text-primary">
                  {settingsTagline(settings)}
                </span>
                <Settings2 className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
              <p className="text-[11px] text-muted-foreground">
                默认 DeepSeek V4 Pro。点击可切换模型或接入你自己的 OpenAI 兼容端点。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {creating ? '正在创建…' : '创建并进入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model settings */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onSave={(next) => {
          setSettings(next);
          saveSettings(next);
          toast({
            title: '设置已保存',
            description:
              next.mode === 'compat'
                ? `之后的生成走自定义端点 ${next.model}`
                : `之后的生成使用 ${settingsLabel(next)}`,
          });
        }}
      />

      {/* Onboarding guide */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AtomForge 怎么用</DialogTitle>
            <DialogDescription>四步就能拿到一个能跑、能改、能分享的项目。</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-3">
              {GUIDE_STEPS.map((step) => (
                <div key={step.title} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[13px] font-semibold text-primary">{step.title}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              ))}

              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-[12.5px] font-semibold">需求这样写更容易一次成型</p>
                <div className="mt-2.5 space-y-2.5">
                  {PROMPT_TIPS.map((tip) => (
                    <div key={tip.title}>
                      <p className="text-[12px] font-medium">{tip.title}</p>
                      <p className="mt-1 flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
                        <ThumbsUp className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        {tip.good}
                      </p>
                      <p className="mt-1 flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground/70">
                        <ThumbsDown className="mt-0.5 h-3 w-3 shrink-0" />
                        {tip.bad}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="text-[12.5px] font-semibold">模型怎么选</p>
                <div className="mt-2 space-y-1.5">
                  {ATOMS_MODELS.map((option) => (
                    <p key={option.id} className="text-[11.5px] leading-snug text-muted-foreground">
                      <span className="font-medium text-foreground">{option.name}</span> · {option.detail}
                    </p>
                  ))}
                  <p className="text-[11.5px] leading-snug text-muted-foreground">
                    也可以在设置里切到「OpenAI 兼容」模式，填自己的 Base URL 与 Key。
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              onClick={() => {
                setGuideOpen(false);
                setCreateOpen(true);
              }}
            >
              开始试一下
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="rename-input">项目名称</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => setRenameTarget(null)}
              disabled={renaming}
            >
              取消
            </Button>
            <Button onClick={handleRename} disabled={renaming} className="gap-1.5">
              {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存名称
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>
              项目文件、对话记录和全部版本快照都会一起删除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              保留项目
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="gap-1.5">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              删除项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
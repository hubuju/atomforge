import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  Globe,
  History,
  LayoutTemplate,
  Lightbulb,
  Loader2,
  Monitor,
  Package,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { StatePanel, TopBar } from '@/components/AppShell';
import { CodeViewer } from '@/components/CodeViewer';
import { AuditPanel } from '@/components/AuditPanel';
import { Pipeline, type StageInfo, type StageState } from '@/components/Pipeline';
import { RoleLanes } from '@/components/RoleLanes';
import { SpecPanel } from '@/components/SpecPanel';
import { SettingsDialog } from '@/components/SettingsDialog';
import {
  buildMessages,
  buildPreview,
  GUIDE_STEPS,
  isRunnable,
  mergeFiles,
  PROMPT_TIPS,
  readPreviewMessage,
  runGeneration,
  STARTER_IDEAS,
  stripProtocol,
  summarize,
  type PreviewError,
  type Stage,
} from '@/lib/agent';
import {
  buildProject,
  emptyLanes,
  LaneBoard,
  outcomeNarrative,
  planProject,
  type Lane,
} from '@/lib/orchestrator';
import { specHeadline, type ProjectSpec } from '@/lib/roles';
import {
  auditPrompt,
  emptyAudit,
  isRuntimeReport,
  mergeAudit,
  runtimeAudit,
  staticAudit,
  type AuditCheck,
  type AuditResult,
} from '@/lib/audit';
import { ENTRY_FILE, fileLang, totalChars } from '@/lib/bundler';
import { exportProjectZip, exportSingleFile, exportStandalone } from '@/lib/exporter';
import {
  hasRoleOverride,
  loadSettings,
  saveSettings,
  settingsLabel,
  settingsTagline,
  type ModelSettings,
} from '@/lib/settings';
import {
  api,
  errorText,
  formatTime,
  useSession,
  type MessageRecord,
  type ProjectFile,
  type VersionRecord,
  type WorkspaceRecord,
} from '@/lib/client';

type ViewMode = 'preview' | 'code' | 'split';
type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: '100%',
  tablet: '820px',
  mobile: '390px',
};

const DEVICE_LABEL: Record<Device, string> = {
  desktop: '桌面',
  tablet: '平板',
  mobile: '手机',
};

const FILE_TONE: Record<string, string> = {
  html: 'ink-html',
  css: 'ink-css',
  js: 'ink-js',
  json: 'ink-json',
  md: 'text-muted-foreground',
  text: 'text-muted-foreground',
};

/** Live state of the round currently being generated. */
interface StreamingTurn {
  /** Local echo of the user's prompt, shown until the row is persisted. */
  echo: string;
  text: string;
  files: ProjectFile[];
  writing: string;
  continuation: number;
  stage: Stage;
  /** True while an automatic repair round (triggered by self-check) is running. */
  repairing: boolean;
}

/** A round waiting at the spec-confirmation gate. */
interface PendingPlan {
  brief: string;
  spec: ProjectSpec;
  /** Row id of the persisted user message, so it is not written twice. */
  messageSaved: boolean;
}

const STAGE_LABEL: Record<Stage, string> = {
  plan: '读需求',
  write: '写文件',
  audit: '自检',
  render: '运行',
};

/**
 * Three-pane workspace: conversation, generated source files, live sandbox.
 *
 * Generation runs in one of two modes. Multi-agent mode drives the four-role
 * pipeline (Planner → Coder → Reviewer → Fixer) with an optional stop at the
 * spec gate; classic mode keeps the original single-call path. Either way the
 * rule-based preview self-check runs afterwards as the final safety net.
 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [project, setProject] = useState<WorkspaceRecord | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');

  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [versions, setVersions] = useState<VersionRecord[]>([]);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState<string>(ENTRY_FILE);
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);

  const [settings, setSettings] = useState<ModelSettings>(() => loadSettings());
  const [lanes, setLanes] = useState<Lane[]>(() => emptyLanes(loadSettings()));
  const [laneTitle, setLaneTitle] = useState('');
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);

  const [view, setView] = useState<ViewMode>('split');
  const [device, setDevice] = useState<Device>('desktop');
  const [runtimeError, setRuntimeError] = useState<PreviewError | null>(null);

  const [audit, setAudit] = useState<AuditResult>(() => emptyAudit());
  const [auditPending, setAuditPending] = useState(false);
  const [auditVisible, setAuditVisible] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const [noteTarget, setNoteTarget] = useState<VersionRecord | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const kickedOff = useRef(false);
  /** Static findings awaiting the runtime pass for the current preview. */
  const staticChecks = useRef<AuditCheck[]>([]);
  /** Guard so a single generation round triggers at most one auto repair. */
  const repairGuard = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Latest runtime error seen from the sandbox (drives the auto repair). */
  const runtimeErrorRef = useRef<PreviewError | null>(null);
  /** Debounce timer collecting an error burst into a single repair round. */
  const errorRepairTimer = useRef<number | null>(null);
  const generatingRef = useRef(false);

  useEffect(() => {
    generatingRef.current = generating;
  }, [generating]);

  const ready = session.status === 'authenticated';

  const displayFiles = streaming?.files.length ? mergeFiles(files, streaming.files) : files;

  const activeFile =
    displayFiles.find((file) => file.path === activePath) || displayFiles[0] || null;

  const runnable = isRunnable(displayFiles);

  const loadAll = useCallback(async () => {
    if (!Number.isFinite(projectId)) {
      setLoadError('项目地址无效');
      setLoadState('error');
      return;
    }
    setLoadState('loading');
    try {
      const [record, msgs, vers] = await Promise.all([
        api.getWorkspace(projectId),
        api.listMessages(projectId),
        api.listVersions(projectId),
      ]);
      if (!record) {
        setLoadError('项目不存在或已被删除');
        setLoadState('error');
        return;
      }
      setProject(record);
      setMessages(msgs);
      setVersions(vers);
      setFiles(record.files || []);
      setActivePath(record.files?.[0]?.path || ENTRY_FILE);
      if (record.files?.length) setPreviewSrc(buildPreview(record.files));
      setLoadState('ready');
    } catch (error) {
      setLoadError(errorText(error, '项目加载失败'));
      setLoadState('error');
    }
  }, [projectId]);

  useEffect(() => {
    if (ready) void loadAll();
  }, [ready, loadAll]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming, pendingPlan, lanes]);

  const refreshPreview = useCallback((next: ProjectFile[], withAudit: boolean) => {
    setRuntimeError(null);
    setPreviewSrc(buildPreview(next));
    setPreviewKey((key) => key + 1);

    if (!withAudit || !settingsRef.current.autoAudit) {
      staticChecks.current = [];
      setAuditPending(false);
      return;
    }
    // Static findings land immediately; the runtime pass fills in once the
    // sandbox reports back what it really rendered.
    const checks = staticAudit(next);
    staticChecks.current = checks;
    setAudit(mergeAudit(checks, null));
    setAuditPending(true);
    setAuditVisible(true);
  }, []);

  /** Persist the user's prompt bubble, tolerating a storage hiccup. */
  const saveUserMessage = useCallback(
    async (workspaceId: number, prompt: string, kind: 'text' | 'fix') => {
      try {
        const row = await api.createMessage({
          workspace_id: workspaceId,
          role: 'user',
          content: prompt,
          kind,
        });
        setMessages((prev) => [...prev, row]);
        return true;
      } catch (error) {
        toast({ title: '消息保存失败', description: errorText(error), variant: 'destructive' });
        return false;
      }
    },
    [toast],
  );

  /**
   * Persist one completed round: files, assistant bubble and version snapshot.
   * Shared by both generation modes so history stays consistent.
   */
  const commitRound = useCallback(
    async (options: {
      workspace: WorkspaceRecord;
      nextFiles: ProjectFile[];
      narrative: string;
      prompt: string;
      note: string;
      staticResult: AuditResult;
      auditOn: boolean;
    }) => {
      const { workspace, nextFiles, narrative, prompt, note, staticResult, auditOn } = options;
      const nextVersionNo = (versions[0]?.version_no || 0) + 1;

      await api.updateWorkspace(workspace.id, {
        files: nextFiles,
        version_count: nextVersionNo,
      });

      const [assistantRow, versionRow] = await Promise.all([
        api.createMessage({
          workspace_id: workspace.id,
          role: 'assistant',
          content: narrative,
          kind: 'text',
        }),
        api.createVersion({
          workspace_id: workspace.id,
          version_no: nextVersionNo,
          files: nextFiles,
          summary: summarize(narrative, prompt),
          note,
          keep_limit: settingsRef.current.versionKeep,
          audit: auditOn
            ? JSON.stringify({
                ok: staticResult.ok,
                errors: staticResult.errors.length,
                warnings: staticResult.warnings.length,
              })
            : '',
        }),
      ]);

      setMessages((prev) => [...prev, assistantRow]);
      setVersions((prev) => [versionRow, ...prev]);
      setProject((prev) =>
        prev ? { ...prev, files: nextFiles, version_count: nextVersionNo } : prev,
      );
    },
    [versions],
  );

  /* ---------------- Classic single-call generation ---------------- */

  const generateClassic = useCallback(
    async (instruction: string, kind: 'text' | 'fix' = 'text', isRepair = false) => {
      if (!project || generating) return;
      const prompt = instruction.trim();
      if (!prompt) return;

      const active = settingsRef.current;
      if (!isRepair) repairGuard.current = false;

      setGenerating(true);
      setRuntimeError(null);
      setAuditVisible(false);
      setStreaming({
        echo: isRepair ? '' : prompt,
        text: '',
        files: [],
        writing: '',
        continuation: 0,
        stage: 'plan',
        repairing: isRepair,
      });
      if (!isRepair) setInput('');

      const saved = await saveUserMessage(project.id, prompt, kind);
      if (saved) setStreaming((prev) => (prev ? { ...prev, echo: '' } : prev));

      try {
        const result = await runGeneration({
          messages: buildMessages(messages, prompt, files, active.maxFiles),
          settings: active,
          onProgress: (parsed) => {
            setStreaming((prev) =>
              prev
                ? {
                    ...prev,
                    text: parsed.text,
                    files: parsed.files,
                    writing: parsed.writing,
                    stage: parsed.files.length ? 'write' : 'plan',
                  }
                : prev,
            );
            if (parsed.writing) setActivePath(parsed.writing);
          },
          onContinue: (round) => {
            setStreaming((prev) => (prev ? { ...prev, continuation: round } : prev));
          },
        });

        const nextFiles = mergeFiles(files, result.files);

        setStreaming((prev) => (prev ? { ...prev, stage: 'audit' } : prev));
        const checks = active.autoAudit ? staticAudit(nextFiles) : [];
        const staticResult = mergeAudit(checks, null);

        setFiles(nextFiles);
        setActivePath(result.files[0]?.path || ENTRY_FILE);
        setStreaming((prev) => (prev ? { ...prev, stage: 'render' } : prev));
        refreshPreview(nextFiles, true);

        const narrative =
          result.text ||
          `已更新 ${result.files.map((file) => file.path).join('、')}，共 ${nextFiles.length} 个文件。`;

        await commitRound({
          workspace: project,
          nextFiles,
          narrative,
          prompt,
          note: '',
          staticResult,
          auditOn: active.autoAudit,
        });

        if (result.truncated) {
          toast({
            title: '代码可能未完整写完',
            description: '已自动续写多轮但仍未收尾，建议说「继续把剩下的写完」。',
            variant: 'destructive',
          });
        }

        if (
          active.autoAudit &&
          active.autoFix &&
          !repairGuard.current &&
          staticResult.errors.length > 0
        ) {
          repairGuard.current = true;
          setGenerating(false);
          setStreaming(null);
          await generateClassic(auditPrompt(staticResult), 'fix', true);
          return;
        }
      } catch (error) {
        toast({ title: '生成失败', description: errorText(error), variant: 'destructive' });
      } finally {
        setStreaming(null);
        setGenerating(false);
      }
    },
    [project, generating, messages, files, refreshPreview, saveUserMessage, commitRound, toast],
  );

  /* ---------------- Multi-agent: stage 2 (build) ---------------- */

  const runBuild = useCallback(
    async (plan: PendingPlan, board: LaneBoard) => {
      if (!project) return;
      const active = settingsRef.current;
      repairGuard.current = false;

      setPendingPlan(null);
      setGenerating(true);
      setLaneTitle(specHeadline(plan.spec));
      setStreaming({
        echo: '',
        text: `按规格实现「${plan.spec.title}」…`,
        files: [],
        writing: '',
        continuation: 0,
        stage: 'write',
        repairing: false,
      });

      try {
        const outcome = await buildProject({
          spec: plan.spec,
          files,
          settings: active,
          board,
          onFiles: (next, writing) => {
            setFiles(next);
            setActivePath(writing);
            setStreaming((prev) => (prev ? { ...prev, files: next, writing } : prev));
          },
        });

        setStreaming((prev) => (prev ? { ...prev, stage: 'audit', writing: '' } : prev));
        const checks = active.autoAudit ? staticAudit(outcome.files) : [];
        const staticResult = mergeAudit(checks, null);

        setFiles(outcome.files);
        setActivePath(outcome.files[0]?.path || ENTRY_FILE);
        setStreaming((prev) => (prev ? { ...prev, stage: 'render' } : prev));
        refreshPreview(outcome.files, true);

        await commitRound({
          workspace: project,
          nextFiles: outcome.files,
          narrative: outcomeNarrative(plan.spec, outcome),
          prompt: plan.brief,
          note: specHeadline(plan.spec),
          staticResult,
          auditOn: active.autoAudit,
        });

        setLaneTitle(
          outcome.fixed.length
            ? `完成 · 修复了 ${outcome.fixed.length} 个文件`
            : '完成 · 审查未发现需要动代码的问题',
        );

        if (
          active.autoAudit &&
          active.autoFix &&
          !repairGuard.current &&
          staticResult.errors.length > 0
        ) {
          repairGuard.current = true;
          setGenerating(false);
          setStreaming(null);
          await generateClassic(auditPrompt(staticResult), 'fix', true);
          return;
        }
      } catch (error) {
        toast({ title: '生成失败', description: errorText(error), variant: 'destructive' });
      } finally {
        setStreaming(null);
        setGenerating(false);
      }
    },
    [project, files, refreshPreview, commitRound, generateClassic, toast],
  );

  const boardRef = useRef<LaneBoard | null>(null);
  const runBuildRef = useRef(runBuild);
  runBuildRef.current = runBuild;

  /* ---------------- Multi-agent: stage 1 (plan) ---------------- */

  const generateMulti = useCallback(
    async (instruction: string) => {
      if (!project || generating) return;
      const prompt = instruction.trim();
      if (!prompt) return;

      const active = settingsRef.current;
      setGenerating(true);
      setRuntimeError(null);
      setAuditVisible(false);
      setPendingPlan(null);
      setLaneTitle('');
      setInput('');
      setStreaming({
        echo: prompt,
        text: '规划者正在拆解需求…',
        files: [],
        writing: '',
        continuation: 0,
        stage: 'plan',
        repairing: false,
      });

      const board = new LaneBoard(active, setLanes);
      boardRef.current = board;

      const saved = await saveUserMessage(project.id, prompt, 'text');
      if (saved) setStreaming((prev) => (prev ? { ...prev, echo: '' } : prev));

      let spec: ProjectSpec;
      try {
        spec = await planProject({ brief: prompt, files, settings: active, board });
      } catch (error) {
        toast({ title: '规划失败', description: errorText(error), variant: 'destructive' });
        setStreaming(null);
        setGenerating(false);
        return;
      }

      const plan: PendingPlan = { brief: prompt, spec, messageSaved: saved };

      if (active.confirmSpec) {
        // Stop at the gate: let the user review or edit before any code exists.
        setStreaming(null);
        setGenerating(false);
        setPendingPlan(plan);
        setLaneTitle('等待你确认规格');
        return;
      }

      await runBuildRef.current(plan, board);
    },
    [project, generating, files, saveUserMessage, toast],
  );

  /** Route a new instruction to whichever mode is configured. */
  const generate = useCallback(
    async (instruction: string, kind: 'text' | 'fix' = 'text', isRepair = false) => {
      if (settingsRef.current.multiAgent && kind === 'text' && !isRepair) {
        await generateMulti(instruction);
        return;
      }
      await generateClassic(instruction, kind, isRepair);
    },
    [generateMulti, generateClassic],
  );

  const generateRef = useRef(generate);
  generateRef.current = generate;

  // Sandbox reports: runtime errors feed the fix banner, the probe report
  // completes the self-check and can trigger one automatic repair round.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = readPreviewMessage(event.data);
      if (!payload) return;

      if (payload.type === 'ready') {
        setRuntimeError(null);
        runtimeErrorRef.current = null;
        return;
      }
      if (payload.type === 'error') {
        setRuntimeError(payload.error);
        runtimeErrorRef.current = payload.error;
        // Runtime errors feed an automatic repair round instead of waiting
        // for the user to click "让 AI 修". A burst of errors (the same
        // crash often reports several lines) collapses into ONE round.
        const active = settingsRef.current;
        if (active.autoFix && !repairGuard.current && !generatingRef.current) {
          if (errorRepairTimer.current !== null) window.clearTimeout(errorRepairTimer.current);
          errorRepairTimer.current = window.setTimeout(() => {
            errorRepairTimer.current = null;
            if (repairGuard.current || generatingRef.current) return;
            const latest = runtimeErrorRef.current;
            if (!latest) return;
            repairGuard.current = true;
            void generateRef.current(
              `预览运行时报错，请定位并修复：${latest.message}${
                latest.line ? `（行 ${latest.line}）` : ''
              }\n\n重点排查：逐一检查 app.js 中所有 addEventListener / getElementById / querySelector，
              确认对应的元素 id 真实存在于 index.html；缺失的元素要么补上，要么加判空保护。
              修复后重新输出被改动文件的完整内容。`,
              'fix',
              true,
            );
          }, 900);
        }
        return;
      }
      if (payload.type !== 'report' || !isRuntimeReport(payload.report)) return;

      const base = staticChecks.current;
      const merged = base.length
        ? mergeAudit(base, runtimeAudit(payload.report, files))
        : mergeAudit([], runtimeAudit(payload.report, files));
      setAudit(merged);
      setAuditPending(false);
      setAuditVisible(true);
      staticChecks.current = [];

      const active = settingsRef.current;
      if (active.autoAudit && active.autoFix && !repairGuard.current && merged.errors.length > 0) {
        repairGuard.current = true;
        void generateRef.current(auditPrompt(merged), 'fix', true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [files]);

  // Auto-start the first round when the project was created with a brief.
  useEffect(() => {
    const brief = (location.state as { brief?: string } | null)?.brief;
    if (!brief || kickedOff.current || loadState !== 'ready' || files.length > 0) return;
    kickedOff.current = true;
    navigate(location.pathname, { replace: true, state: null });
    void generate(brief);
  }, [location, loadState, files.length, generate, navigate]);

  /**
   * Arriving from a template: the project already runs, so any brief the user
   * typed is a follow-up edit. Prefill it and let them review before spending a
   * generation round — silently rewriting a working template would be worse.
   */
  useEffect(() => {
    const state = location.state as { fromTemplate?: string; pendingBrief?: string } | null;
    if (!state?.fromTemplate || kickedOff.current || loadState !== 'ready') return;
    kickedOff.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (state.pendingBrief) setInput(state.pendingBrief);
    toast({
      title: `已套用项目「${state.fromTemplate}」`,
      description: state.pendingBrief
        ? '需求已填在输入框，确认后发送即可开始改。'
        : '右侧已经能直接运行，接着说需求就能继续改。',
    });
  }, [location, loadState, navigate, toast]);

  const handleConfirmSpec = (spec: ProjectSpec) => {
    if (!pendingPlan) return;
    const board = boardRef.current || new LaneBoard(settingsRef.current, setLanes);
    boardRef.current = board;
    void runBuild({ ...pendingPlan, spec }, board);
  };

  const handleCancelSpec = () => {
    setPendingPlan(null);
    setLaneTitle('已放弃这一轮');
    setLanes(emptyLanes(settingsRef.current));
    toast({ title: '已放弃这一轮规划', description: '可以改写需求后重新发送。' });
  };

  const handleRollback = async (version: VersionRecord) => {
    if (!project) return;
    try {
      setFiles(version.files);
      setActivePath(version.files[0]?.path || ENTRY_FILE);
      refreshPreview(version.files, true);
      await api.updateWorkspace(project.id, { files: version.files });
      setProject((prev) => (prev ? { ...prev, files: version.files } : prev));
      setHistoryOpen(false);
      toast({ title: `已回滚到 v${version.version_no}` });
    } catch (error) {
      toast({ title: '回滚失败', description: errorText(error), variant: 'destructive' });
    }
  };

  const handleSaveNote = async () => {
    if (!noteTarget) return;
    setSavingNote(true);
    try {
      const updated = await api.updateVersionNote(noteTarget.id, noteValue);
      setVersions((prev) =>
        prev.map((item) => (item.id === noteTarget.id ? { ...item, note: updated.note } : item)),
      );
      setNoteTarget(null);
      toast({ title: `v${noteTarget.version_no} 的备注已保存` });
    } catch (error) {
      toast({ title: '备注保存失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setSavingNote(false);
    }
  };

  const handlePublish = async () => {
    if (!project) return;
    setPublishing(true);
    try {
      const res = await api.publishWorkspace(project.id);
      setProject((prev) =>
        prev ? { ...prev, is_published: true, share_slug: res.share_slug } : prev,
      );
      const url = `${window.location.origin}/s/${res.share_slug}`;
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: '已发布并复制链接', description: url });
      } catch {
        toast({ title: '已发布', description: url });
      }
    } catch (error) {
      toast({ title: '发布失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Save the current file set as a personal template. Kept deliberately simple:
   * a snapshot of what's on screen, not a live link — later edits to the project
   * must not silently mutate a template the user already relies on.
   */
  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      toast({ title: '请给项目起个名字', variant: 'destructive' });
      return;
    }
    if (displayFiles.length === 0) {
      toast({ title: '还没有可保存的代码', variant: 'destructive' });
      return;
    }
    setSavingTemplate(true);
    try {
      await api.saveTemplate({
        name,
        description: templateDesc.trim(),
        files: displayFiles.map((file) => ({ path: file.path, content: file.content })),
      });
      setTemplateOpen(false);
      setTemplateName('');
      setTemplateDesc('');
      toast({
        title: '已存为我的项目',
        description: '回到工作区新建项目时就能选到它。',
      });
    } catch (error) {
      toast({ title: '保存项目失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleExportZip = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const latestNote = versions[0]?.note || '';
      const res = await exportProjectZip(project.name, displayFiles, latestNote);
      toast({
        title: '源码已导出',
        description: `${res.filename} · ${(res.bytes / 1024).toFixed(1)} KB`,
      });
    } catch (error) {
      toast({ title: '导出失败', description: errorText(error), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const handleExportStandalone = () => {
    if (!project) return;
    try {
      const res = exportStandalone(project.name, displayFiles);
      toast({ title: '单文件版本已导出', description: res.filename });
    } catch (error) {
      toast({ title: '导出失败', description: errorText(error), variant: 'destructive' });
    }
  };

  const handleExportCurrent = () => {
    if (!activeFile) return;
    try {
      const res = exportSingleFile(activeFile);
      toast({ title: '已下载', description: res.filename });
    } catch (error) {
      toast({ title: '导出失败', description: errorText(error), variant: 'destructive' });
    }
  };

  const handleSaveEdit = async () => {
    if (!project || !activeFile) return;
    const next = mergeFiles(files, [{ path: activeFile.path, content: draft }]);
    setFiles(next);
    setEditing(false);
    repairGuard.current = true; // manual edits should not trigger an auto rewrite
    refreshPreview(next, true);
    try {
      await api.updateWorkspace(project.id, { files: next });
      setProject((prev) => (prev ? { ...prev, files: next } : prev));
      toast({ title: `${activeFile.path} 已保存并重新运行` });
    } catch (error) {
      toast({ title: '保存失败', description: errorText(error), variant: 'destructive' });
    }
  };

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      toast({ title: `已复制 ${activeFile.path}` });
    } catch {
      toast({ title: '复制失败，请手动选择代码', variant: 'destructive' });
    }
  };

  const chatBubbles = useMemo(() => {
    const rows = messages.map((row) => ({
      key: `m-${row.id}`,
      role: row.role,
      // The file protocol is an internal transport detail: the chat pane only
      // ever shows prose, while the code lives in the file tree.
      content: row.role === 'assistant' ? stripProtocol(row.content) : row.content,
      kind: row.kind,
    }));
    if (streaming?.echo) {
      rows.push({ key: 'echo', role: 'user' as const, content: streaming.echo, kind: 'text' });
    }
    return rows;
  }, [messages, streaming]);

  /** Map the live round onto the four real pipeline stages (classic mode). */
  const stages = useMemo<StageInfo[]>(() => {
    const order: Stage[] = ['plan', 'write', 'audit', 'render'];
    const currentIndex = streaming ? order.indexOf(streaming.stage) : order.length;

    const detailFor = (stage: Stage, state: StageState): string => {
      if (stage === 'plan') {
        return state === 'active' ? '正在理解需求' : '需求已解析';
      }
      if (stage === 'write') {
        if (state === 'active') {
          if (streaming?.continuation) return `续写第 ${streaming.continuation} 段`;
          return streaming?.writing ? streaming.writing : '准备写入文件';
        }
        return `${displayFiles.length} 个文件 · ${totalChars(displayFiles)} 字符`;
      }
      if (stage === 'audit') {
        if (state === 'active') return '检查结构与交互绑定';
        if (auditPending) return '等待运行结果';
        if (!settings.autoAudit) return '已关闭';
        if (audit.errors.length) return `${audit.errors.length} 个阻塞问题`;
        if (audit.warnings.length) return `${audit.warnings.length} 处提示`;
        return audit.checks.length ? '全部通过' : '待运行';
      }
      return state === 'active' ? '装载到沙箱' : runnable ? '预览已就绪' : '等待生成';
    };

    return order.map((stage, index) => {
      let state: StageState = 'idle';
      if (!streaming) {
        state = displayFiles.length ? 'done' : 'idle';
        if (stage === 'audit' && audit.errors.length) state = 'failed';
      } else if (index < currentIndex) state = 'done';
      else if (index === currentIndex) state = 'active';

      return { id: stage, label: STAGE_LABEL[stage], detail: detailFor(stage, state), state };
    });
  }, [streaming, displayFiles, audit, auditPending, runnable, settings.autoAudit]);

  const laneVisible =
    settings.multiAgent && (generating || Boolean(pendingPlan) || lanes.some((lane) => lane.ms > 0));

  if (session.status === 'anonymous') return <Navigate to="/auth" replace />;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar
        session={session}
        lead={
          <>
            <span className="text-muted-foreground/40">/</span>
            <span className="max-w-[180px] truncate text-[13px] font-medium">
              {project?.name || '加载中…'}
            </span>
            {project ? (
              <span className="nums-tabular rounded border border-border bg-secondary px-1.5 py-px font-code text-[10.5px] text-muted-foreground">
                v{project.version_count || 0}
              </span>
            ) : null}
          </>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSettingsOpen(true)}
        >
          {settings.multiAgent ? (
            <Users className="h-3.5 w-3.5" />
          ) : (
            <Settings2 className="h-3.5 w-3.5" />
          )}
          <span className="hidden xl:inline">
            {settings.multiAgent ? '四角色' : settingsLabel(settings)}
          </span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              disabled={displayFiles.length === 0 || exporting}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span className="hidden lg:inline">导出</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[248px]">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              导出的是分离的多文件源码
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void handleExportZip()}>
              <Package className="mr-2 h-3.5 w-3.5" />
              <span className="flex-1">整个项目 .zip</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportStandalone} disabled={!runnable}>
              <Globe className="mr-2 h-3.5 w-3.5" />
              <span className="flex-1">单文件 standalone.html</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportCurrent} disabled={!activeFile}>
              <FileDown className="mr-2 h-3.5 w-3.5" />
              <span className="flex-1 truncate">当前文件 {activeFile?.path || ''}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setTemplateName(project ? `${project.name} 模板` : '我的项目');
                setTemplateOpen(true);
              }}
            >
              <LayoutTemplate className="mr-2 h-3.5 w-3.5" />
              <span className="flex-1">存为我的项目</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setHistoryOpen(true)}
          disabled={versions.length === 0}
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">版本</span>
          {versions.length ? (
            <span className="nums-tabular font-code text-[11px]">{versions.length}</span>
          ) : null}
        </Button>

        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={handlePublish}
          disabled={publishing || !runnable}
        >
          {publishing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
          {project?.is_published ? '更新分享' : '发布'}
        </Button>
      </TopBar>

      {loadState === 'loading' ? (
        <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Skeleton className="h-full w-full rounded-xl" />
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      ) : loadState === 'error' ? (
        <StatePanel
          tone="danger"
          icon={<TriangleAlert className="h-5 w-5" />}
          title="项目打不开"
          description={loadError}
          action={
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              回到工作区
            </Button>
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,400px)_1fr]">
          {/* Conversation */}
          <section className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[12.5px] font-medium">对话</span>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors ease-out-quart duration-200 hover:md:border-primary/40 hover:md:text-foreground"
              >
                <span className="max-w-[130px] truncate">{settingsLabel(settings)}</span>
                <span className="rounded border border-border bg-background px-1 py-px text-[10px]">
                  {settings.multiAgent
                    ? hasRoleOverride(settings)
                      ? '四角色 · 混合模型'
                      : '四角色'
                    : settingsTagline(settings)}
                </span>
              </button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 p-3">
                {chatBubbles.length === 0 && !streaming && !pendingPlan ? (
                  <div className="rounded-xl border border-dashed border-border bg-card/40 p-4">
                    <p className="text-[13px] font-medium">告诉智能体你想做什么</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      {settings.multiAgent
                        ? '规划者会先把需求拆成规格给你确认，然后实现者按文件逐个写代码，审查者挑问题，修复者定点修。'
                        : '它会先说方案，再逐个文件写出 index.html / styles.css / app.js，运行后自动做一次体检。'}
                    </p>
                    <div className="mt-3 space-y-1.5">
                      {STARTER_IDEAS.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setInput(idea)}
                          className="block w-full rounded-lg border border-border bg-secondary/40 px-2.5 py-2 text-left text-[11.5px] leading-snug text-muted-foreground transition-colors ease-out-quart duration-200 hover:md:border-primary/40 hover:md:text-foreground"
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {chatBubbles.map((row) => (
                  <div
                    key={row.key}
                    className={row.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                  >
                    <div
                      className={`max-w-[92%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                        row.role === 'user'
                          ? 'bg-primary/15 text-foreground ring-1 ring-primary/25'
                          : 'border border-border bg-card text-muted-foreground'
                      }`}
                    >
                      {row.kind === 'fix' ? (
                        <span className="mb-1 flex items-center gap-1 text-[11px] text-destructive">
                          <Wrench className="h-3 w-3" />
                          修错请求
                        </span>
                      ) : null}
                      <p className="whitespace-pre-wrap">{row.content}</p>
                    </div>
                  </div>
                ))}

                {laneVisible ? <RoleLanes lanes={lanes} title={laneTitle} /> : null}

                {pendingPlan ? (
                  <SpecPanel
                    spec={pendingPlan.spec}
                    busy={generating}
                    onConfirm={handleConfirmSpec}
                    onCancel={handleCancelSpec}
                  />
                ) : null}

                {streaming ? (
                  <div className="space-y-2">
                    {settings.multiAgent ? null : <Pipeline stages={stages} />}
                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-xl border border-border bg-card px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
                        {streaming.repairing ? (
                          <span className="tone-warn mb-1.5 flex items-center gap-1.5 text-[11px]">
                            <ShieldCheck className="h-3 w-3" />
                            自检发现问题，正在自动修复
                          </span>
                        ) : null}
                        <p className="whitespace-pre-wrap">{streaming.text || '…'}</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={chatEndRef} />
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-border p-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void generate(input);
                  }
                }}
                placeholder={
                  pendingPlan
                    ? '先确认上面的规格，或放弃这轮再重写需求'
                    : files.length
                      ? '继续提修改，例如「加一个深色模式开关」'
                      : '描述你想要的应用…'
                }
                rows={3}
                className="resize-none text-[13px] leading-relaxed"
                disabled={generating || Boolean(pendingPlan)}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors ease-out-quart duration-200 hover:md:text-foreground"
                >
                  <Lightbulb className="h-3 w-3 text-primary" />
                  怎么用
                </button>
                <span className="text-[11px] text-muted-foreground/70">⌘/Ctrl + Enter 发送</span>
                <Button
                  size="sm"
                  className="ml-auto h-8 gap-1.5"
                  onClick={() => void generate(input)}
                  disabled={generating || Boolean(pendingPlan) || !input.trim()}
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                  {generating ? '生成中' : '发送'}
                </Button>
              </div>
            </div>
          </section>

          {/* Files + preview */}
          <section className="flex min-h-0 flex-col">
            <div className="flex h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3">
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5">
                {(
                  [
                    { id: 'preview' as ViewMode, icon: Eye, label: '预览' },
                    { id: 'code' as ViewMode, icon: Code2, label: '代码' },
                    { id: 'split' as ViewMode, icon: Columns2, label: '分屏' },
                  ]
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors ease-out-quart duration-200 ${
                      view === item.id
                        ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                        : 'text-muted-foreground hover:md:text-foreground'
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </button>
                ))}
              </div>

              {view !== 'code' ? (
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-secondary/50 p-0.5">
                  {(
                    [
                      { id: 'desktop' as Device, icon: Monitor },
                      { id: 'tablet' as Device, icon: Tablet },
                      { id: 'mobile' as Device, icon: Smartphone },
                    ]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDevice(item.id)}
                      aria-label={DEVICE_LABEL[item.id]}
                      className={`rounded-md px-1.5 py-1 transition-colors ease-out-quart duration-200 ${
                        device === item.id
                          ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                          : 'text-muted-foreground hover:md:text-foreground'
                      }`}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                {generating ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {STAGE_LABEL[streaming?.stage || 'plan']}
                  </span>
                ) : pendingPlan ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    待确认规格
                  </span>
                ) : runtimeError || audit.errors.length ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                    <TriangleAlert className="h-3 w-3" />
                    有问题
                  </span>
                ) : runnable && audit.runtimeSeen ? (
                  <span className="chip-ok inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                    <ShieldCheck className="h-3 w-3" />
                    自检通过
                  </span>
                ) : runnable ? (
                  <span className="chip-ok inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                    <Check className="h-3 w-3" />
                    运行正常
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                    等待生成
                  </span>
                )}

                {audit.checks.length && !auditVisible ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => setAuditVisible(true)}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    体检报告
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="重新运行并自检"
                  onClick={() => {
                    repairGuard.current = true;
                    refreshPreview(displayFiles, true);
                  }}
                  disabled={!runnable}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {auditVisible ? (
              <AuditPanel
                result={audit}
                pending={auditPending}
                busy={generating}
                onFix={() => {
                  repairGuard.current = true;
                  void generate(auditPrompt(audit), 'fix', true);
                }}
                onDismiss={() => setAuditVisible(false)}
              />
            ) : null}

            {runtimeError ? (
              <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="min-w-0 flex-1 break-words font-code text-[11.5px] leading-relaxed text-destructive">
                  {runtimeError.message}
                  {runtimeError.line ? ` (行 ${runtimeError.line})` : ''}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1 !bg-transparent hover:!bg-transparent"
                  disabled={generating}
                  onClick={() => {
                    repairGuard.current = true;
                    void generate(
                      `预览运行时报错，请定位并修复：${runtimeError.message}${
                        runtimeError.line ? `（行 ${runtimeError.line}）` : ''
                      }`,
                      'fix',
                      true,
                    );
                  }}
                >
                  <Wrench className="h-3 w-3" />
                  让 AI 修复
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="忽略报错"
                  onClick={() => setRuntimeError(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : null}

            <div
              className={`grid min-h-0 flex-1 ${
                view === 'split' ? 'grid-rows-2 xl:grid-cols-2 xl:grid-rows-1' : 'grid-rows-1'
              }`}
            >
              {/* Source files */}
              {view !== 'preview' ? (
                <div className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-2">
                    <span className="pl-1 text-[11px] text-muted-foreground">
                      {displayFiles.length ? `项目文件 · ${displayFiles.length}` : '还没有文件'}
                    </span>

                    {activeFile ? (
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="下载当前文件"
                          onClick={handleExportCurrent}
                        >
                          <FileDown className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="复制当前文件"
                          onClick={handleCopy}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        {editing ? (
                          <>
                            <Button
                              size="sm"
                              className="h-6 gap-1 px-2 text-[11px]"
                              onClick={handleSaveEdit}
                            >
                              <Check className="h-3 w-3" />
                              保存运行
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label="放弃修改"
                              onClick={() => setEditing(false)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="编辑当前文件"
                            disabled={generating}
                            onClick={() => {
                              setDraft(activeFile.content);
                              setEditing(true);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex min-h-0 flex-1">
                    {/* File tree */}
                    <div className="flex w-40 shrink-0 flex-col overflow-y-auto border-r border-border bg-card/30 py-1.5">
                      {displayFiles.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => {
                            setActivePath(file.path);
                            setEditing(false);
                          }}
                          className={`flex items-center gap-2 border-l-2 px-3 py-1.5 text-left font-code text-[11.5px] transition-colors ease-out-quart duration-200 ${
                            activeFile?.path === file.path
                              ? 'border-primary bg-primary/[0.08] text-foreground'
                              : 'border-transparent text-muted-foreground hover:md:bg-secondary/40 hover:md:text-foreground'
                          }`}
                        >
                          <FileCode2 className={`h-3.5 w-3.5 shrink-0 ${FILE_TONE[fileLang(file.path)]}`} />
                          <span className="truncate">{file.path}</span>
                          {streaming?.writing === file.path ? (
                            <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-primary" />
                          ) : null}
                        </button>
                      ))}
                    </div>

                    {/* File content */}
                    <div className="min-h-0 flex-1">
                      {!activeFile ? (
                        <div className="grid h-full place-items-center px-6 text-center">
                          <p className="text-[12.5px] text-muted-foreground">
                            生成完成后，这里会按文件展示源码。
                          </p>
                        </div>
                      ) : editing ? (
                        <Textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          spellCheck={false}
                          className="h-full w-full resize-none rounded-none border-0 bg-[hsl(80_6%_8%)] font-code text-[12.5px] leading-[1.65] focus-visible:ring-0"
                        />
                      ) : (
                        <CodeViewer
                          path={activeFile.path}
                          content={activeFile.content}
                          streaming={streaming?.writing === activeFile.path}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-card/40 px-3 text-[10.5px] text-muted-foreground">
                    <span className="font-code uppercase">
                      {activeFile ? fileLang(activeFile.path) : '—'}
                    </span>
                    <span className="nums-tabular">
                      {activeFile ? activeFile.content.split('\n').length : 0} 行
                    </span>
                    <span className="nums-tabular ml-auto">
                      项目共 {displayFiles.length} 个文件 · {totalChars(displayFiles)} 字符
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Live sandbox */}
              {view !== 'code' ? (
                <div className="flex min-h-0 flex-col bg-[hsl(80_6%_9%)]">
                  {previewSrc ? (
                    <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3">
                      <iframe
                        key={previewKey}
                        title="应用预览"
                        srcDoc={previewSrc}
                        sandbox="allow-scripts allow-forms allow-modals allow-popups"
                        className="h-full rounded-lg border border-border bg-white shadow-lg"
                        style={{ width: DEVICE_WIDTH[device], maxWidth: '100%' }}
                      />
                    </div>
                  ) : (
                    <div className="grid flex-1 place-items-center px-6 text-center">
                      <div>
                        <div className="mx-auto grid h-11 w-11 place-items-center rounded-lg border border-border bg-secondary text-primary">
                          <Eye className="h-5 w-5" />
                        </div>
                        <p className="mt-3 text-[13px] font-medium">预览区还是空的</p>
                        <p className="mt-1.5 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
                          在左侧描述需求，生成完成后应用会在这里直接运行，并自动做一次体检。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {/* Save as personal template */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>存为我的项目</DialogTitle>
            <DialogDescription>
              保存当前 {displayFiles.length} 个文件的快照。之后新建项目时可以直接从它起步，
              这里再怎么改都不会影响已保存的项目。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="template-name">项目名称</Label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="例如：我的后台管理骨架"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-desc">说明（可选）</Label>
              <Textarea
                id="template-desc"
                value={templateDesc}
                onChange={(event) => setTemplateDesc(event.target.value)}
                placeholder="这个项目适合做什么、已经包含了哪些部分"
                rows={3}
                className="resize-none leading-relaxed"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => setTemplateOpen(false)}
              disabled={savingTemplate}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleSaveTemplate()}
              disabled={savingTemplate}
              className="gap-1.5"
            >
              {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onSave={(next) => {
          setSettings(next);
          saveSettings(next);
          setLanes(emptyLanes(next));
          toast({
            title: '设置已保存',
            description: next.multiAgent
              ? `四角色流水线已启用${next.confirmSpec ? '，规格需要你确认' : '，规格自动继续'}`
              : `退回单次生成，使用 ${settingsLabel(next)}`,
          });
        }}
      />

      {/* Version history */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
            <DialogDescription>
              每轮生成都会存一份完整文件快照。写上备注，几天后也知道这一版做了什么。
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <span className="nums-tabular shrink-0 rounded border border-border bg-secondary px-1.5 py-px font-code text-[11px] text-primary">
                      v{version.version_no}
                    </span>
                    <div className="min-w-0 flex-1">
                      {version.note ? (
                        <p className="flex items-start gap-1.5 text-[12.5px] font-medium leading-relaxed">
                          <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                          <span className="min-w-0 break-words">{version.note}</span>
                        </p>
                      ) : null}
                      <p
                        className={`text-[12px] leading-relaxed ${
                          version.note ? 'mt-1 text-muted-foreground' : ''
                        }`}
                      >
                        {version.summary || '（无摘要）'}
                      </p>
                      <p className="nums-tabular mt-1 text-[10.5px] text-muted-foreground">
                        {formatTime(version.created_at)} · {version.files.length} 个文件
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => {
                        setNoteTarget(version);
                        setNoteValue(version.note || '');
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      {version.note ? '改备注' : '加备注'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 gap-1 !bg-transparent hover:!bg-transparent"
                      onClick={() => void handleRollback(version)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      回滚到这一版
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Version note */}
      <Dialog open={Boolean(noteTarget)} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>给 v{noteTarget?.version_no} 写备注</DialogTitle>
            <DialogDescription>
              一句话说清这一版的状态，例如「配色定稿，排行榜还没做」。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Input
              value={noteValue}
              onChange={(event) => setNoteValue(event.target.value)}
              placeholder="例如：可用版本，交给同事演示"
              maxLength={200}
              autoFocus
            />
            <p className="nums-tabular text-right text-[10.5px] text-muted-foreground">
              {noteValue.length}/200
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => setNoteTarget(null)}
              disabled={savingNote}
            >
              取消
            </Button>
            <Button onClick={() => void handleSaveNote()} disabled={savingNote} className="gap-1.5">
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存备注
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guide */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AtomForge 怎么用</DialogTitle>
            <DialogDescription>四步拿到一个能跑、能改、能带走的项目。</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-3">
              {GUIDE_STEPS.map((step) => (
                <div key={step.title} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[13px] font-semibold text-primary">{step.title}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
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
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setGuideOpen(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
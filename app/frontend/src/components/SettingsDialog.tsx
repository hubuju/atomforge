import { useEffect, useState } from 'react';
import {
  Boxes,
  Check,
  Code2,
  Compass,
  Globe,
  Info,
  KeyRound,
  Monitor,
  Moon,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  Users,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ROLE_META } from '@/lib/roles';
import { setThemePref, useTheme, type ThemePref } from '@/lib/theme';
import {
  ATOMS_MODELS,
  DEFAULT_SETTINGS,
  emptyRoleModels,
  ENDPOINT_PRESETS,
  ROLE_IDS,
  validateSettings,
  type ModelSettings,
  type RoleId,
  type RunMode,
} from '@/lib/settings';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ModelSettings;
  onSave: (next: ModelSettings) => void;
}

type Tab = 'model' | 'agents' | 'about';

const MODE_COPY: Record<RunMode, { title: string; detail: string }> = {
  atoms: {
    title: '内置模型',
    detail: '服务端转发，密钥不落浏览器',
  },
  compat: {
    title: 'OpenAI 兼容',
    detail: '自定义端点，SSE 流式',
  },
};

const ROLE_ICON: Record<RoleId, typeof Compass> = {
  planner: Compass,
  coder: Code2,
  reviewer: ShieldCheck,
  fixer: Wrench,
};

const THEME_OPTIONS: { value: ThemePref; label: string; hint: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', hint: '明亮环境', icon: Sun },
  { value: 'dark', label: '深色', hint: '长时间编码', icon: Moon },
  { value: 'system', label: '跟随系统', hint: '自动切换', icon: Monitor },
];

/**
 * Real model configuration — every control here changes generation behaviour.
 * Proxy mode keeps credentials server-side; compat mode talks directly to any
 * OpenAI-compatible endpoint the user owns. The agents tab wires the four-role
 * pipeline: whether to use it, whether to stop for spec confirmation, which
 * model each role runs on, and how many repair loops are allowed.
 */
export function SettingsDialog({ open, onOpenChange, value, onSave }: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>('model');
  const [draft, setDraft] = useState<ModelSettings>(value);
  const [error, setError] = useState('');
  const { pref: themePref, resolved: resolvedTheme } = useTheme();

  // Re-seed the form each time the dialog opens so a cancelled edit is discarded.
  useEffect(() => {
    if (open) {
      setDraft(value);
      setError('');
      setTab('model');
    }
  }, [open, value]);

  const patch = (next: Partial<ModelSettings>) => {
    setDraft((prev) => ({ ...prev, ...next }));
    setError('');
  };

  const setRoleModel = (role: RoleId, model: string) => {
    patch({ roleModels: { ...draft.roleModels, [role]: model } });
  };

  const handleSave = () => {
    const message = validateSettings(draft);
    if (message) {
      setError(message);
      setTab('model');
      return;
    }
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>配置模型、运行模式与多智能体流水线</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/50 p-0.5">
          {(
            [
              { id: 'model' as Tab, icon: Boxes, label: '模型' },
              { id: 'agents' as Tab, icon: Users, label: '多智能体' },
              { id: 'about' as Tab, icon: Info, label: '说明' },
            ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ease-out-quart duration-200 ${
                tab === item.id
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                  : 'text-muted-foreground hover:md:text-foreground'
              }`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        <ScrollArea className="max-h-[56vh] pr-3">
          {tab === 'model' ? (
            <div className="space-y-5 py-1">
              {/* Appearance — shares the same store as the top-bar toggle. */}
              <div className="space-y-2">
                <Label className="text-[12.5px]">外观</Label>
                <div className="grid grid-cols-3 gap-2">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setThemePref(option.value)}
                      className={`rounded-lg border p-2.5 text-left transition-colors ease-out-quart duration-200 ${
                        themePref === option.value
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border bg-card hover:md:border-primary/30'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <option.icon
                          className={`h-3.5 w-3.5 ${
                            themePref === option.value ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        />
                        <span className="text-[12px] font-medium">{option.label}</span>
                      </span>
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                        {option.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  当前生效：{resolvedTheme === 'dark' ? '深色' : '浅色'}，顶栏也能随时切换。
                </p>
              </div>

              {/* Run mode */}
              <div className="space-y-2">
                <Label className="text-[12.5px]">运行模式</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['atoms', 'compat'] as RunMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        patch({
                          mode,
                          model:
                            mode === 'atoms'
                              ? DEFAULT_SETTINGS.model
                              : draft.model && draft.mode === 'compat'
                                ? draft.model
                                : ENDPOINT_PRESETS[0].model,
                          baseUrl:
                            mode === 'compat' && !draft.baseUrl
                              ? ENDPOINT_PRESETS[0].baseUrl
                              : draft.baseUrl,
                          // Built-in model ids mean nothing to a custom endpoint.
                          roleModels: emptyRoleModels(),
                        })
                      }
                      className={`rounded-lg border p-3 text-left transition-colors ease-out-quart duration-200 ${
                        draft.mode === mode
                          ? 'border-primary/50 bg-primary/10'
                          : 'border-border bg-card hover:md:border-primary/30'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium">{MODE_COPY[mode].title}</span>
                        {draft.mode === mode ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                        {MODE_COPY[mode].detail}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {draft.mode === 'atoms' ? (
                <div className="space-y-2">
                  <Label className="text-[12.5px]">默认模型</Label>
                  <div className="space-y-1.5">
                    {ATOMS_MODELS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => patch({ model: option.id })}
                        className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ease-out-quart duration-200 ${
                          draft.model === option.id
                            ? 'border-primary/50 bg-primary/10'
                            : 'border-border bg-card hover:md:border-primary/30'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-medium">{option.name}</span>
                            <span className="rounded border border-border bg-secondary px-1 py-px text-[10px] text-muted-foreground">
                              {option.tagline}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                            {option.detail}
                          </span>
                        </div>
                        {draft.model === option.id ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    这是所有角色的默认模型，可在「多智能体」里给单个角色单独指定。
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-[12.5px]">快速填入</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ENDPOINT_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            patch({ baseUrl: preset.baseUrl, model: preset.model })
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ease-out-quart duration-200 ${
                            draft.baseUrl === preset.baseUrl
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border bg-secondary/50 text-muted-foreground hover:md:border-primary/30 hover:md:text-foreground'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {ENDPOINT_PRESETS.find((preset) => preset.baseUrl === draft.baseUrl)?.hint ||
                        '任何提供 /chat/completions 的服务都可以接入。'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="setting-model" className="text-[12.5px]">
                      模型名称
                    </Label>
                    <Input
                      id="setting-model"
                      value={draft.model}
                      onChange={(event) => patch({ model: event.target.value })}
                      placeholder="glm-4-plus"
                      className="font-code text-[12.5px]"
                    />
                    <p className="text-[11px] text-muted-foreground">填写服务端认识的模型标识。</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="setting-base" className="flex items-center gap-1.5 text-[12.5px]">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      API Base URL
                    </Label>
                    <Input
                      id="setting-base"
                      value={draft.baseUrl}
                      onChange={(event) => patch({ baseUrl: event.target.value })}
                      placeholder="https://open.bigmodel.cn/api/paas/v4"
                      className="font-code text-[12.5px]"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      不用带 /chat/completions，系统会自动补上。
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="setting-key" className="flex items-center gap-1.5 text-[12.5px]">
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                      API Key
                    </Label>
                    <Input
                      id="setting-key"
                      type="password"
                      value={draft.apiKey}
                      onChange={(event) => patch({ apiKey: event.target.value })}
                      placeholder="sk-..."
                      className="font-code text-[12.5px]"
                    />
                  </div>

                  <div className="chip-warn flex items-start gap-2 rounded-lg border p-2.5">
                    <ShieldAlert className="tone-warn mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p className="tone-warn-soft text-[11px] leading-relaxed">
                      浏览器侧存储 Key 存在安全风险，且需要目标服务允许跨域访问。日常使用建议切回
                      内置模型模式。
                    </p>
                  </div>
                </>
              )}

              {/* Generation behaviour */}
              <div className="space-y-4 rounded-lg border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium">
                  <Sliders className="h-3.5 w-3.5 text-primary" />
                  生成行为
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] font-normal">最多拆分文件数</Label>
                    <span className="nums-tabular font-code text-[11px] text-muted-foreground">
                      {draft.maxFiles}
                    </span>
                  </div>
                  <Slider
                    value={[draft.maxFiles]}
                    min={1}
                    max={50}
                    step={1}
                    onValueChange={(next) => patch({ maxFiles: Math.round(next[0]) })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    这条会写进提示词，作为项目拆分的参考上限，不再强制。
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px] font-normal">版本保留上限</Label>
                    <span className="nums-tabular font-code text-[11px] text-muted-foreground">
                      {draft.versionKeep}
                    </span>
                  </div>
                  <Slider
                    value={[draft.versionKeep]}
                    min={5}
                    max={50}
                    step={1}
                    onValueChange={(next) => patch({ versionKeep: Math.round(next[0]) })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    每个项目最多留多少个历史版本，超出后自动清掉最旧的，写了备注的不会被清。
                  </p>
                </div>

                <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <Label className="text-[12px] font-normal">生成后自动体检</Label>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      检查空白页、按钮未绑定、脚本被截断等基础问题。
                    </p>
                  </div>
                  <Switch
                    checked={draft.autoAudit}
                    onCheckedChange={(checked) =>
                      patch({ autoAudit: checked, autoFix: checked ? draft.autoFix : false })
                    }
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Label className="text-[12px] font-normal">发现阻塞问题自动修</Label>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      自动把问题回喂给智能体再跑一轮，最多一次。
                    </p>
                  </div>
                  <Switch
                    checked={draft.autoFix}
                    disabled={!draft.autoAudit}
                    onCheckedChange={(checked) => patch({ autoFix: checked })}
                  />
                </div>
              </div>

              {error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11.5px] text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : tab === 'agents' ? (
            <div className="space-y-4 py-1">
              <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/25 bg-primary/[0.05] p-3">
                <div className="min-w-0">
                  <Label className="text-[12.5px]">多智能体流水线（始终开启）</Label>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    规划者 → 实现者 → 审查者 → 修复者 四个角色接力是产品核心形态，不可关闭。下面只配置审查修复与规格确认。
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <Label className="text-[12.5px]">规格需要我确认</Label>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      开启后规划者出规格会停下来等你确认或编辑；关闭则自动继续，规格只作展示。
                    </p>
                  </div>
                  <Switch
                    checked={draft.confirmSpec}
                    onCheckedChange={(checked) => patch({ confirmSpec: checked })}
                  />
                </div>

                <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <Label className="text-[12.5px]">生成后审查与修复</Label>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      实现者写完代码后，审查者挑问题、修复者定点修。关闭可显著加速，但少了模型层面的质量把关（静态体检仍然保留）。
                    </p>
                  </div>
                  <Switch
                    checked={draft.reviewFix}
                    onCheckedChange={(checked) => patch({ reviewFix: checked })}
                  />
                </div>

                <div
                  className={`space-y-2 rounded-lg border border-border bg-card p-3 transition-opacity duration-200 ${
                    draft.reviewFix ? '' : 'pointer-events-none opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Label className="text-[12.5px]">审查 → 修复轮次上限</Label>
                    <span className="nums-tabular font-code text-[11px] text-muted-foreground">
                      {draft.maxRepairRounds}
                    </span>
                  </div>
                  <Slider
                    value={[draft.maxRepairRounds]}
                    min={0}
                    max={3}
                    step={1}
                    onValueChange={(next) => patch({ maxRepairRounds: Math.round(next[0]) })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {draft.maxRepairRounds === 0
                      ? '0 表示只审查、不自动修复，问题会列在报告里。'
                      : `最多让修复者返工 ${draft.maxRepairRounds} 轮，防止无限打转。`}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-[12.5px]">按角色指定模型</Label>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    留空表示继承默认模型。传输方式与 Key 始终共用，所以单独换模型不会影响连通性。
                  </p>

                  <div className="space-y-2">
                    {ROLE_IDS.map((role) => {
                      const meta = ROLE_META[role];
                      const Icon = ROLE_ICON[role];
                      const current = draft.roleModels[role] || '';

                      return (
                        <div key={role} className="rounded-lg border border-border bg-card p-2.5">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="text-[12px] font-medium">{meta.name}</span>
                            <span className="font-code text-[10px] text-muted-foreground">
                              {meta.short}
                            </span>
                            <span className="ml-auto rounded border border-border bg-secondary px-1 py-px text-[10px] text-muted-foreground">
                              {meta.io}
                            </span>
                          </div>
                          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                            {meta.duty}
                          </p>

                          {draft.mode === 'atoms' ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => setRoleModel(role, '')}
                                className={`rounded-md border px-2 py-1 text-[10.5px] transition-colors ease-out-quart duration-200 ${
                                  current === ''
                                    ? 'border-primary/50 bg-primary/10 text-primary'
                                    : 'border-border bg-secondary/50 text-muted-foreground hover:md:text-foreground'
                                }`}
                              >
                                继承默认
                              </button>
                              {ATOMS_MODELS.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => setRoleModel(role, option.id)}
                                  className={`rounded-md border px-2 py-1 text-[10.5px] transition-colors ease-out-quart duration-200 ${
                                    current === option.id
                                      ? 'border-primary/50 bg-primary/10 text-primary'
                                      : 'border-border bg-secondary/50 text-muted-foreground hover:md:text-foreground'
                                  }`}
                                >
                                  {option.name}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <Input
                              value={current}
                              onChange={(event) => setRoleModel(role, event.target.value)}
                              placeholder={`继承默认（${draft.model || '未设置'}）`}
                              className="mt-2 h-7 font-code text-[11.5px]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => patch({ roleModels: emptyRoleModels() })}
                  >
                    <RotateCcw className="h-3 w-3" />
                    全部改回继承默认
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-1 text-[12px] leading-relaxed text-muted-foreground">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[12.5px] font-medium text-foreground">为什么要拆成四个角色</p>
                <p className="mt-1.5">
                  一个提示词同时负责「想清楚、全写完、再自己挑错」，需求越复杂越容易漏，输出越长越容易被截断，
                  而且每轮全量重写会把上一轮改好的地方改坏。拆开之后：规划者只产出规格，实现者按文件逐个写、
                  一次只想一个文件，审查者对照规格挑毛病，修复者只改被点名的文件。
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[12.5px] font-medium text-foreground">角色之间怎么传递信息</p>
                <p className="mt-1.5">
                  规格、文件集合、问题清单是共享状态（黑板），不靠对话历史往下传，每个角色只读它需要的部分。
                  编排器负责推进顺序并限制修复轮次，泳道里可以展开看每个角色收到什么、交出什么。
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[12.5px] font-medium text-foreground">两种运行模式的区别</p>
                <p className="mt-1.5">
                  <span className="text-foreground">内置模型</span>：请求由应用自己的后端转发到服务端配置的
                  OpenAI 兼容提供商（默认 DeepSeek），密钥留在服务端，开箱即用。
                </p>
                <p className="mt-1">
                  <span className="text-foreground">OpenAI 兼容</span>：浏览器直连你自己的端点，
                  用你自己的额度；需要该服务允许跨域，且密钥存在本机。
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-[12.5px] font-medium text-foreground">自动体检查什么</p>
                <p className="mt-1.5">
                  审查者是模型层面的语义审查，体检是规则层面的兜底：静态层看结构完整性、文件引用是否存在、
                  脚本括号是否配平；运行层在沙箱加载后回报真实渲染的元素数量与事件绑定数量，用来区分
                  「画出来了」和「真的能点」。两者互补，都会保留。
                </p>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setDraft({ ...DEFAULT_SETTINGS, roleModels: emptyRoleModels() });
              setError('');
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="!bg-transparent hover:!bg-transparent"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleSave}>
              <Save className="h-3.5 w-3.5" />
              保存设置
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
/**
 * Real, user-owned model configuration.
 *
 * Two run modes are supported and both are actually wired into the generation
 * path — this is not a decorative dropdown:
 *
 * - `atoms`   : requests go through the app's own backend relay
 *               (`POST /api/v1/aihub/gentxt`), which forwards to the
 *               OpenAI-compatible provider configured server-side
 *               (default: DeepSeek). No key ever lives in the browser.
 * - `compat`  : requests go straight to any OpenAI-compatible `/chat/completions`
 *               endpoint the user owns (GLM, DeepSeek, Qwen, vLLM, OpenRouter…),
 *               with SSE streaming parsed client-side.
 *
 * Every field below changes real behaviour: `model`/`temperature` are sent with
 * the request, `maxFiles` is injected into the system prompt, `autoAudit` and
 * `autoFix` drive the post-generation self-check loop, and the multi-agent
 * block drives the Planner → Coder → Reviewer → Fixer orchestration.
 */

export type RunMode = 'atoms' | 'compat';

/** The four roles the orchestrator drives. */
export type RoleId = 'planner' | 'coder' | 'reviewer' | 'fixer';

export const ROLE_IDS: RoleId[] = ['planner', 'coder', 'reviewer', 'fixer'];

export interface ModelOption {
  id: string;
  name: string;
  tagline: string;
  detail: string;
}

/**
 * Built-in models, served through the app's own backend relay. The relay
 * forwards to the OpenAI-compatible provider configured server-side
 * (default: DeepSeek), so these ids must exist on that provider.
 */
export const ATOMS_MODELS: ModelOption[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    tagline: '代码专家',
    detail: '默认模型，生成质量最高，复杂交互与精致视觉首选',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    tagline: '高速实惠',
    detail: '响应更快、成本更低，简单工具页够用',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    tagline: '深度推理',
    detail: '复杂需求规划更缜密，响应稍慢',
  },
];

/** Ready-made endpoints so `compat` mode is one click, not a research project. */
export interface EndpointPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    hint: '在智谱开放平台「API Keys」页面获取',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    hint: '在 DeepSeek 开放平台创建 API Key',
  },
  {
    id: 'dashscope',
    label: '阿里通义 DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    hint: '使用 DashScope 的 OpenAI 兼容模式地址',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    hint: '一个 Key 转发到多家模型',
  },
  {
    id: 'local',
    label: '本地 / 自建（vLLM、Ollama）',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder',
    hint: '需要服务端允许浏览器跨域访问',
  },
];

export interface ModelSettings {
  mode: RunMode;
  /** Model id sent with the request (the default for every role). */
  model: string;
  /** Base URL used in `compat` mode; `/chat/completions` is appended. */
  baseUrl: string;
  /** Bearer key used in `compat` mode. Never sent anywhere else. */
  apiKey: string;
  /** 0 = 稳定复现，1 = 更有想象力。 */
  temperature: number;
  /** Upper bound on generated project files, injected into the system prompt. */
  maxFiles: number;
  /**
   * How many snapshots to keep per project. Older *unlabelled* versions are
   * pruned server-side once the window overflows; snapshots the user bothered
   * to name are pinned and never evicted.
   */
  versionKeep: number;
  /** Run the self-check after every generation round. */
  autoAudit: boolean;
  /** Let the agent silently repair blocking defects found by the self-check. */
  autoFix: boolean;
  /** Drive generation through the four-role pipeline instead of one big call. */
  multiAgent: boolean;
  /** Pause after the Planner so the spec can be reviewed and edited. */
  confirmSpec: boolean;
  /**
   * Run the Reviewer → Fixer loop after the Coder finishes. Turning this off
   * skips both stages entirely — much faster, but no model-level quality gate.
   */
  reviewFix: boolean;
  /** Per-role model override; empty string means "inherit the global model". */
  roleModels: Record<RoleId, string>;
  /** How many Reviewer → Fixer loops the orchestrator may run. */
  maxRepairRounds: number;
}

export function emptyRoleModels(): Record<RoleId, string> {
  return { planner: '', coder: '', reviewer: '', fixer: '' };
}

/** Sensible defaults so the product works before anyone opens settings. */
export const DEFAULT_SETTINGS: ModelSettings = {
  mode: 'atoms',
  model: ATOMS_MODELS[0].id,
  baseUrl: '',
  apiKey: '',
  temperature: 0.3,
  maxFiles: 6,
  versionKeep: 20,
  autoAudit: true,
  autoFix: true,
  multiAgent: true,
  confirmSpec: true,
  // Off by default: the Reviewer/Fixer loop costs extra rounds and the
  // user prefers speed; static + runtime self-checks still run regardless.
  reviewFix: false,
  roleModels: emptyRoleModels(),
  maxRepairRounds: 1,
};

const STORAGE_KEY = 'atomforge.settings.v2';

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Treat a missing or non-numeric field as "not configured" instead of as zero.
 * `Number(null)` is `0`, which would otherwise be clamped to the minimum of the
 * range and silently look like a deliberate choice.
 */
function numeric(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return Number.NaN;
  return Number(raw);
}

function normalizeRoleModels(raw: unknown): Record<RoleId, string> {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<RoleId, unknown>>;
  const out = emptyRoleModels();
  ROLE_IDS.forEach((role) => {
    const value = source[role];
    out[role] = typeof value === 'string' ? value.trim() : '';
  });
  return out;
}

/** Read stored settings, repairing any field that no longer makes sense. */
export function loadSettings(): ModelSettings {
  let raw = '';
  try {
    raw = window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return { ...DEFAULT_SETTINGS, roleModels: emptyRoleModels() };
  }
  if (!raw) return { ...DEFAULT_SETTINGS, roleModels: emptyRoleModels() };

  try {
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    const mode: RunMode = parsed.mode === 'compat' ? 'compat' : 'atoms';
    const model = (parsed.model || '').trim();
    return {
      mode,
      // A model id saved under a previous deployment (e.g. claude-opus-5 on
      // Atoms Cloud) may no longer exist on the configured provider; fall
      // back to the default instead of sending doomed requests.
      model:
        mode === 'atoms'
          ? ATOMS_MODELS.some((item) => item.id === model)
            ? model
            : DEFAULT_SETTINGS.model
          : model || ENDPOINT_PRESETS[0].model,
      baseUrl: (parsed.baseUrl || '').trim(),
      apiKey: (parsed.apiKey || '').trim(),
      temperature: clamp(numeric(parsed.temperature), 0, 1, DEFAULT_SETTINGS.temperature),
      maxFiles: Math.round(clamp(numeric(parsed.maxFiles), 1, 50, DEFAULT_SETTINGS.maxFiles)),
      versionKeep: Math.round(
        clamp(numeric(parsed.versionKeep), 5, 50, DEFAULT_SETTINGS.versionKeep),
      ),
      autoAudit: parsed.autoAudit !== false,
      autoFix: parsed.autoFix !== false,
      multiAgent: parsed.multiAgent !== false,
      confirmSpec: parsed.confirmSpec !== false,
      // Opt-in (default off): only an explicit `true` enables the loop.
      reviewFix: parsed.reviewFix === true,
      roleModels: normalizeRoleModels(parsed.roleModels),
      maxRepairRounds: Math.round(
        clamp(numeric(parsed.maxRepairRounds), 0, 3, DEFAULT_SETTINGS.maxRepairRounds),
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, roleModels: emptyRoleModels() };
  }
}

export function saveSettings(settings: ModelSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode — settings live for this page load only */
  }
}

export function findAtomsModel(id: string): ModelOption {
  return ATOMS_MODELS.find((item) => item.id === id) || ATOMS_MODELS[0];
}

/** Short label for the toolbar chip. */
export function settingsLabel(settings: ModelSettings): string {
  if (settings.mode === 'atoms') return findAtomsModel(settings.model).name;
  return settings.model || '自定义端点';
}

export function settingsTagline(settings: ModelSettings): string {
  if (settings.mode === 'atoms') return findAtomsModel(settings.model).tagline;
  return 'OpenAI 兼容';
}

/**
 * Resolve the settings a single role should run with. A role either inherits
 * the global model or overrides just the model id — transport, key, base URL
 * and temperature always stay shared, so an override can never break the
 * connection.
 */
export function resolveRoleSettings(settings: ModelSettings, role: RoleId): ModelSettings {
  const override = (settings.roleModels?.[role] || '').trim();
  if (!override) return settings;
  if (settings.mode === 'atoms' && !ATOMS_MODELS.some((item) => item.id === override)) {
    return settings;
  }
  return { ...settings, model: override };
}

/** Human-readable model name actually used by a role. */
export function roleModelLabel(settings: ModelSettings, role: RoleId): string {
  const resolved = resolveRoleSettings(settings, role);
  if (settings.mode === 'atoms') return findAtomsModel(resolved.model).name;
  return resolved.model || '自定义端点';
}

/** True when at least one role deviates from the global model. */
export function hasRoleOverride(settings: ModelSettings): boolean {
  return ROLE_IDS.some((role) => Boolean((settings.roleModels?.[role] || '').trim()));
}

/** Block saving a configuration that cannot possibly generate anything. */
export function validateSettings(settings: ModelSettings): string {
  if (settings.mode === 'atoms') {
    if (!ATOMS_MODELS.some((item) => item.id === settings.model)) return '请选择一个内置模型';
    return '';
  }
  if (!settings.model.trim()) return '请填写模型名称，例如 glm-4-plus';
  const url = settings.baseUrl.trim();
  if (!url) return '请填写 API Base URL';
  if (!/^https?:\/\//i.test(url)) return 'Base URL 需要以 http:// 或 https:// 开头';
  if (/\/chat\/completions\/?$/i.test(url)) {
    return 'Base URL 不要带 /chat/completions，系统会自动补上';
  }
  if (!settings.apiKey.trim()) return '请填写 API Key';
  return '';
}

/** Normalize the endpoint the streaming layer will POST to. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
}
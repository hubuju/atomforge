import { beforeEach, describe, expect, it } from 'vitest';

import {
  ATOMS_MODELS,
  DEFAULT_SETTINGS,
  ENDPOINT_PRESETS,
  chatCompletionsUrl,
  emptyRoleModels,
  findAtomsModel,
  hasRoleOverride,
  loadSettings,
  resolveRoleSettings,
  roleModelLabel,
  saveSettings,
  settingsLabel,
  settingsTagline,
  validateSettings,
  type ModelSettings,
} from '@/lib/settings';

/**
 * Settings drive real request behaviour: transport, model id, temperature,
 * prompt limits, retention and the self-check loop. A field that silently loads
 * back as `undefined` or `NaN` breaks generation, so every persisted value is
 * checked for repair-on-read.
 */

const STORAGE_KEY = 'atomforge.settings.v2';

function base(overrides: Partial<ModelSettings> = {}): ModelSettings {
  return { ...DEFAULT_SETTINGS, roleModels: emptyRoleModels(), ...overrides };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadSettings', () => {
  it('没有存储时返回默认值', () => {
    const settings = loadSettings();
    expect(settings.mode).toBe('atoms');
    expect(settings.model).toBe(ATOMS_MODELS[0].id);
    expect(settings.roleModels).toEqual(emptyRoleModels());
  });

  it('存储损坏时回落到默认值而不是抛错', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ 这不是 json');
    expect(loadSettings().model).toBe(DEFAULT_SETTINGS.model);
  });

  it('保存后能完整读回', () => {
    const settings = base({
      mode: 'compat',
      model: 'glm-4-plus',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k-123',
      temperature: 0.8,
      maxFiles: 5,
      versionKeep: 30,
      autoFix: false,
      maxRepairRounds: 2,
    });
    saveSettings(settings);
    const loaded = loadSettings();
    expect(loaded.mode).toBe('compat');
    expect(loaded.model).toBe('glm-4-plus');
    expect(loaded.apiKey).toBe('k-123');
    expect(loaded.temperature).toBe(0.8);
    expect(loaded.versionKeep).toBe(30);
    expect(loaded.autoFix).toBe(false);
    expect(loaded.maxRepairRounds).toBe(2);
  });

  it('越界与非法数值被夹回合法区间', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: 'atoms',
        model: 'deepseek-v4-pro',
        temperature: 9,
        maxFiles: 99,
        versionKeep: 1,
        maxRepairRounds: 12,
      }),
    );
    const loaded = loadSettings();
    expect(loaded.temperature).toBe(1);
    expect(loaded.maxFiles).toBe(50);
    expect(loaded.versionKeep).toBe(5);
    expect(loaded.maxRepairRounds).toBe(3);
  });

  it('数值字段是垃圾内容时使用默认值', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ model: 'deepseek-v4-pro', temperature: 'hot', versionKeep: null }),
    );
    const loaded = loadSettings();
    expect(loaded.temperature).toBe(DEFAULT_SETTINGS.temperature);
    expect(loaded.versionKeep).toBe(DEFAULT_SETTINGS.versionKeep);
  });

  it('模型名缺失时按模式给出合适兜底', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'compat', model: '  ' }));
    expect(loadSettings().model).toBe(ENDPOINT_PRESETS[0].model);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: 'atoms', model: '' }));
    expect(loadSettings().model).toBe(DEFAULT_SETTINGS.model);
  });

  it('开关类字段默认开启，只有显式 false 才关闭', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ model: 'deepseek-v4-pro' }));
    const loaded = loadSettings();
    expect(loaded.autoAudit).toBe(true);
    expect(loaded.multiAgent).toBe(true);
    expect(loaded.confirmSpec).toBe(true);
  });

  it('角色模型字段被补齐成四个键', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ model: 'deepseek-v4-pro', roleModels: { coder: '  deepseek-reasoner  ', junk: 1 } }),
    );
    const loaded = loadSettings();
    expect(Object.keys(loaded.roleModels).sort()).toEqual([
      'coder',
      'fixer',
      'planner',
      'reviewer',
    ]);
    expect(loaded.roleModels.coder).toBe('deepseek-reasoner');
    expect(loaded.roleModels.planner).toBe('');
  });
});

describe('validateSettings', () => {
  it('内置模式只校验模型是否在清单里', () => {
    expect(validateSettings(base())).toBe('');
    expect(validateSettings(base({ model: 'not-a-model' }))).toContain('内置模型');
  });

  it('兼容模式逐项校验必填与格式', () => {
    const compat = base({ mode: 'compat', model: '', baseUrl: '', apiKey: '' });
    expect(validateSettings(compat)).toContain('模型名称');
    expect(validateSettings({ ...compat, model: 'glm-4-plus' })).toContain('Base URL');
    expect(
      validateSettings({ ...compat, model: 'glm-4-plus', baseUrl: 'open.bigmodel.cn' }),
    ).toContain('http://');
    expect(
      validateSettings({
        ...compat,
        model: 'glm-4-plus',
        baseUrl: 'https://x.com/v1/chat/completions',
      }),
    ).toContain('/chat/completions');
    expect(
      validateSettings({ ...compat, model: 'glm-4-plus', baseUrl: 'https://x.com/v1' }),
    ).toContain('API Key');
    expect(
      validateSettings({
        ...compat,
        model: 'glm-4-plus',
        baseUrl: 'https://x.com/v1',
        apiKey: 'k',
      }),
    ).toBe('');
  });
});

describe('chatCompletionsUrl', () => {
  it('补上路径并去掉多余斜杠', () => {
    expect(chatCompletionsUrl('https://x.com/v1')).toBe('https://x.com/v1/chat/completions');
    expect(chatCompletionsUrl('  https://x.com/v1///  ')).toBe(
      'https://x.com/v1/chat/completions',
    );
  });
});

describe('resolveRoleSettings', () => {
  it('没有覆盖时角色继承全局配置', () => {
    const settings = base();
    expect(resolveRoleSettings(settings, 'coder')).toBe(settings);
  });

  it('内置模式下只接受清单内的覆盖，非法覆盖被忽略', () => {
    const valid = base({ roleModels: { ...emptyRoleModels(), coder: 'deepseek-reasoner' } });
    expect(resolveRoleSettings(valid, 'coder').model).toBe('deepseek-reasoner');

    const invalid = base({ roleModels: { ...emptyRoleModels(), coder: 'wat' } });
    expect(resolveRoleSettings(invalid, 'coder').model).toBe(DEFAULT_SETTINGS.model);
  });

  it('覆盖只改 model，不动传输与密钥', () => {
    const settings = base({
      mode: 'compat',
      model: 'glm-4-plus',
      baseUrl: 'https://x.com/v1',
      apiKey: 'k-1',
      temperature: 0.7,
      roleModels: { ...emptyRoleModels(), reviewer: 'deepseek-v4-pro' },
    });
    const resolved = resolveRoleSettings(settings, 'reviewer');
    expect(resolved.model).toBe('deepseek-v4-pro');
    expect(resolved.baseUrl).toBe('https://x.com/v1');
    expect(resolved.apiKey).toBe('k-1');
    expect(resolved.temperature).toBe(0.7);
  });
});

describe('标签与覆盖检测', () => {
  it('内置模式显示模型中文名与定位', () => {
    const settings = base();
    expect(settingsLabel(settings)).toBe(ATOMS_MODELS[0].name);
    expect(settingsTagline(settings)).toBe(ATOMS_MODELS[0].tagline);
  });

  it('兼容模式显示自填模型名', () => {
    const settings = base({ mode: 'compat', model: 'glm-4-plus' });
    expect(settingsLabel(settings)).toBe('glm-4-plus');
    expect(settingsTagline(settings)).toBe('OpenAI 兼容');
    expect(settingsLabel({ ...settings, model: '' })).toBe('自定义端点');
  });

  it('角色标签跟随覆盖结果', () => {
    const settings = base({ roleModels: { ...emptyRoleModels(), planner: 'deepseek-reasoner' } });
    expect(roleModelLabel(settings, 'planner')).toBe('DeepSeek R1');
    expect(roleModelLabel(settings, 'coder')).toBe(ATOMS_MODELS[0].name);
  });

  it('检测是否存在任意角色覆盖', () => {
    expect(hasRoleOverride(base())).toBe(false);
    expect(hasRoleOverride(base({ roleModels: { ...emptyRoleModels(), fixer: 'x' } }))).toBe(true);
    expect(hasRoleOverride(base({ roleModels: { ...emptyRoleModels(), fixer: '   ' } }))).toBe(
      false,
    );
  });

  it('未知模型 id 回落到第一个内置模型', () => {
    expect(findAtomsModel('nope').id).toBe(ATOMS_MODELS[0].id);
    expect(findAtomsModel('deepseek-reasoner').name).toBe('DeepSeek R1');
  });
});
<template>
  <div class="page ai-settings-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">AI 中心</h1>
        <p class="muted">集中管理模型、总结预设、问答与数据权限、质量回归。API Key 加密保存且不会回显。</p>
      </div>
      <div v-if="activeSection === 'models'" class="toolbar">
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate()">新增配置</el-button>
      </div>
    </div>

    <el-tabs v-model="activeSection" class="panel ai-center-tabs" @tab-change="changeSection">
      <el-tab-pane label="模型配置" name="models">
        <div class="ai-center-pane">
          <section class="ai-module-block ai-preset-panel">
            <div class="section-head"><h2>国内主流模型预设</h2><span class="muted">Base URL 与默认模型可在保存前调整</span></div>
            <div class="ai-preset-grid">
              <button v-for="preset in presets" :key="preset.provider" class="ai-preset-card" type="button" @click="openCreate(preset)">
                <strong>{{ preset.name }}</strong><span>默认：{{ preset.model }}</span><small>{{ preset.models.length }} 个可选模型 · {{ preset.note }}</small>
              </button>
            </div>
          </section>

          <section class="ai-module-block library-table-panel ai-config-panel">
            <div class="section-head"><h2>已保存配置</h2><span class="muted">{{ configurations.length }} 个</span></div>
            <el-table v-loading="loading" :data="configurations" height="100%" class="question-list-table">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="provider" label="提供商" width="110" />
        <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
        <el-table-column label="范围" width="100">
          <template #default="{ row }"><el-tag effect="plain">{{ row.scope === 'personal' ? '个人' : '系统共享' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="baseUrl" label="Base URL" min-width="250" show-overflow-tooltip />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
            <el-tag v-if="row.isDefault" type="primary" class="ai-default-tag">默认</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近测试" min-width="170">
          <template #default="{ row }">
            <span :class="row.lastTestStatus === 'failed' ? 'danger-text' : ''">{{ row.lastTestMessage || '未测试' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本月 Token" min-width="170">
          <template #default="{ row }">{{ formatTokenQuota(row.tokenQuota) }}</template>
        </el-table-column>
        <el-table-column label="估算单价 / 百万 Token" min-width="210">
          <template #default="{ row }">输入 {{ row.inputCostPerMillion }} / 输出 {{ row.outputCostPerMillion }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <template v-if="row.canManage">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" :loading="testingId === row.id" @click="testConnection(row)">测试</el-button>
              <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
            </template>
            <span v-else class="muted">可用于生成</span>
          </template>
        </el-table-column>
            </el-table>
          </section>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="canManageSummaryPresets" label="总结预设" name="summary-presets" lazy>
        <AiSummaryPresetPanel />
      </el-tab-pane>
      <el-tab-pane v-if="canCreateSystem" label="数据权限" name="data-permissions" lazy>
        <AiDataPermissionsPage />
      </el-tab-pane>
      <el-tab-pane v-if="canCreateSystem" label="问答权限" name="chat-permissions" lazy>
        <AiChatPermissionPanel />
      </el-tab-pane>
      <el-tab-pane v-if="canReadQuality" label="质量与回归" name="quality" lazy>
        <AiQualityPanel :configurations="configurations" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑 AI 配置' : '新增 AI 配置'" width="680px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item v-if="!form.id && canCreateSystem" label="配置范围">
          <el-radio-group v-model="form.scope"><el-radio value="system">系统共享</el-radio><el-radio value="personal">仅自己</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="使用预设">
          <el-select v-model="selectedPresetProvider" clearable placeholder="自定义" style="width: 100%" @change="applyPreset">
            <el-option v-for="preset in presets" :key="preset.provider" :label="preset.name" :value="preset.provider" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置名称"><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-form-item label="提供商标识"><el-input v-model="form.provider" maxlength="50" /></el-form-item>
        <el-form-item label="Base URL"><el-input v-model="form.baseUrl" placeholder="https://.../v1" /></el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="form.model"
            filterable
            allow-create
            default-first-option
            placeholder="选择已有模型或输入供应商模型 ID"
            no-data-text="该来源未登记模型，请直接输入模型 ID"
            style="width: 100%"
          >
            <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
          </el-select>
          <span class="muted">一条配置绑定一个 API Key 与模型；同一来源可新增多条配置供生成时切换。</span>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password autocomplete="new-password" :placeholder="form.id ? '留空表示不修改' : '请输入 API Key'" />
        </el-form-item>
        <el-form-item label="超时 / 配置上限">
          <div class="toolbar">
            <el-input-number v-model="form.timeoutMs" :min="3000" :max="120000" :step="1000" /> ms
            <el-input-number v-model="form.maxTokens" :min="1" :max="8192" placeholder="不限制" />
            <span>Token（可选；留空由供应商决定）</span>
            <el-button v-if="form.maxTokens !== undefined" link @click="form.maxTokens = undefined">清除</el-button>
          </div>
        </el-form-item>
        <el-form-item label="月度预算">
          <div class="toolbar">
            <el-input-number v-model="form.monthlyTokenBudget" :min="1000" :step="1000" clearable /> tokens
            <span class="muted">本地预算，留空表示不限制</span>
          </div>
        </el-form-item>
        <el-form-item label="估算单价">
          <div class="toolbar">
            <span>输入</span><el-input-number v-model="form.inputCostPerMillion" :min="0" :precision="4" />
            <span>输出</span><el-input-number v-model="form.outputCostPerMillion" :min="0" :precision="4" />
            <span class="muted">每百万 Token，币种由管理员统一约定</span>
          </div>
        </el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enabled" active-text="启用" /><el-switch v-model="form.isDefault" active-text="设为默认" class="ai-default-switch" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAiSettingsPage } from '../composables/useAiSettingsPage';
import AiDataPermissionsPage from './AiDataPermissionsPage.vue';
import AiChatPermissionPanel from './AiChatPermissionPanel.vue';
import AiQualityPanel from './AiQualityPanel.vue';
import AiSummaryPresetPanel from './AiSummaryPresetPanel.vue';
const {
  applyPreset, canCreateSystem, canManageSummaryPresets, canReadQuality, configurations, dialogVisible, form, formatTokenQuota, load, loading,
  modelOptions,
  openCreate, openEdit, presets, remove, save, saving, selectedPresetProvider, testConnection, testingId,
} = useAiSettingsPage();
const route = useRoute();
const router = useRouter();
const activeSection = ref(normalizeSection(route.query.section));

watch(() => route.query.section, (value) => {
  activeSection.value = normalizeSection(value);
});

function normalizeSection(value: unknown) {
  const section = String(value || 'models');
  if (section === 'data-permissions' && canCreateSystem) return section;
  if (section === 'chat-permissions' && canCreateSystem) return section;
  if (section === 'summary-presets' && canManageSummaryPresets) return section;
  if (section === 'quality' && canReadQuality) return section;
  return 'models';
}

function changeSection(value: string | number) {
  const section = String(value);
  const query = { ...route.query };
  if (section === 'models') delete query.section;
  else query.section = section;
  void router.replace({ query });
}
</script>

<style scoped>
:global(.main:has(> .ai-settings-page)) { overflow: hidden; }
.ai-settings-page { height: 100%; overflow: hidden; }
.ai-center-tabs { flex: 1; min-height: 0; padding: 0 18px 18px; display: flex; flex-direction: column; }
.ai-center-tabs :deep(.el-tabs__header) { margin: 0 -18px 18px; padding: 0 18px; }
.ai-center-tabs :deep(.el-tabs__item) { height: 52px; font-size: 15px; }
.ai-center-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow: hidden; }
.ai-center-tabs :deep(.el-tab-pane) { height: 100%; min-height: 0; overflow: hidden; }
.ai-center-pane { height: 100%; min-height: 0; display: grid; grid-template-rows: auto minmax(260px, 1fr); gap: 18px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.ai-module-block { min-width: 0; }
.ai-preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.ai-preset-card { display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--el-bg-color); cursor: pointer; }
.ai-preset-card:hover { border-color: var(--el-color-primary); }
.ai-preset-card span, .ai-preset-card small { color: var(--el-text-color-secondary); }
.ai-config-panel { height: 100%; min-height: 260px; }
.ai-default-tag { margin-left: 6px; }
.ai-default-switch { margin-left: 24px; }
.danger-text { color: var(--el-color-danger); }
@media (max-height: 760px) {
  .ai-center-pane { grid-template-rows: auto minmax(220px, 1fr); }
  .ai-preset-grid { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
}
</style>

<template>
  <div class="page ai-settings-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">AI 模型配置</h1>
        <p class="muted">仅超级管理员可见。API Key 加密保存，页面和接口不会回显。</p>
      </div>
      <div class="toolbar">
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate()">新增配置</el-button>
      </div>
    </div>

    <section class="panel ai-preset-panel">
      <div class="section-head"><h2>国内主流模型预设</h2><span class="muted">Base URL 与默认模型可在保存前调整</span></div>
      <div class="ai-preset-grid">
        <button v-for="preset in presets" :key="preset.provider" class="ai-preset-card" type="button" @click="openCreate(preset)">
          <strong>{{ preset.name }}</strong><span>{{ preset.model }}</span><small>{{ preset.note }}</small>
        </button>
      </div>
    </section>

    <section class="panel library-table-panel ai-config-panel">
      <div class="section-head"><h2>已保存配置</h2><span class="muted">{{ configurations.length }} 个</span></div>
      <el-table v-loading="loading" :data="configurations" height="100%" class="question-list-table">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="provider" label="提供商" width="110" />
        <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
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
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" :loading="testingId === row.id" @click="testConnection(row)">测试</el-button>
            <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel ai-summary-panel">
      <div class="section-head"><h2>AI 内容总结</h2><span class="muted">管理员辅助分析，不自动修改业务数据</span></div>
      <div class="ai-summary-grid">
        <div class="ai-summary-inputs">
          <el-select v-model="summaryForm.configId" placeholder="默认 AI 配置" clearable style="width: 100%">
            <el-option v-for="item in activeConfigurations" :key="item.id" :label="`${item.name} / ${item.model}`" :value="item.id" />
          </el-select>
          <el-input v-model="summaryForm.instruction" placeholder="总结要求（可选）" maxlength="500" show-word-limit />
          <el-input v-model="summaryForm.content" type="textarea" :rows="9" maxlength="20000" show-word-limit placeholder="粘贴需要总结的考试、教务或统计内容" />
          <div class="toolbar">
            <span class="muted">最大输出</span><el-input-number v-model="summaryForm.maxTokens" :min="1" :max="1200" />
            <el-button type="primary" :loading="summaryLoading" @click="summarize">生成总结</el-button>
          </div>
        </div>
        <div class="ai-summary-result">
          <div class="muted">{{ summaryMeta || 'AI 输出将显示在这里' }}</div>
          <pre>{{ summaryResult }}</pre>
        </div>
      </div>
    </section>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑 AI 配置' : '新增 AI 配置'" width="680px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="使用预设">
          <el-select v-model="selectedPresetProvider" clearable placeholder="自定义" style="width: 100%" @change="applyPreset">
            <el-option v-for="preset in presets" :key="preset.provider" :label="preset.name" :value="preset.provider" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置名称"><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-form-item label="提供商标识"><el-input v-model="form.provider" maxlength="50" /></el-form-item>
        <el-form-item label="Base URL"><el-input v-model="form.baseUrl" placeholder="https://.../v1" /></el-form-item>
        <el-form-item label="模型"><el-input v-model="form.model" /></el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password autocomplete="new-password" :placeholder="form.id ? '留空表示不修改' : '请输入 API Key'" />
        </el-form-item>
        <el-form-item label="超时 / Token">
          <div class="toolbar">
            <el-input-number v-model="form.timeoutMs" :min="3000" :max="120000" :step="1000" /> ms
            <el-input-number v-model="form.maxTokens" :min="1" :max="8192" /> tokens
          </div>
        </el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enabled" active-text="启用" /><el-switch v-model="form.isDefault" active-text="设为默认" class="ai-default-switch" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useAiSettingsPage } from '../composables/useAiSettingsPage';
const {
  activeConfigurations, applyPreset, configurations, dialogVisible, form, load, loading,
  openCreate, openEdit, presets, remove, save, saving, selectedPresetProvider, summarize,
  summaryForm, summaryLoading, summaryMeta, summaryResult, testConnection, testingId,
} = useAiSettingsPage();
</script>

<style scoped>
.ai-settings-page { overflow: auto; }
.ai-preset-panel, .ai-config-panel, .ai-summary-panel { flex: none; }
.ai-preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.ai-preset-card { display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--el-bg-color); cursor: pointer; }
.ai-preset-card:hover { border-color: var(--el-color-primary); }
.ai-preset-card span, .ai-preset-card small { color: var(--el-text-color-secondary); }
.ai-config-panel { height: 360px; }
.ai-default-tag { margin-left: 6px; }
.ai-summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.ai-summary-inputs { display: flex; flex-direction: column; gap: 10px; }
.ai-summary-result { min-height: 300px; padding: 14px; border-radius: 8px; background: var(--el-fill-color-light); }
.ai-summary-result pre { white-space: pre-wrap; word-break: break-word; font: inherit; line-height: 1.7; }
.ai-default-switch { margin-left: 24px; }
.danger-text { color: var(--el-color-danger); }
@media (max-width: 900px) { .ai-summary-grid { grid-template-columns: 1fr; } }
</style>

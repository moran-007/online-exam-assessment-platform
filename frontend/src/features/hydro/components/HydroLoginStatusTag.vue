<template>
  <el-tooltip v-if="account.lastLoginMessage" :content="account.lastLoginMessage" placement="top" :show-after="300">
    <el-tag :type="tagType" class="status-tag">{{ label }}</el-tag>
  </el-tooltip>
  <el-tag v-else :type="tagType" class="status-tag">{{ label }}</el-tag>
</template>

<script setup lang="ts">
import type { HydroLoginState } from '../models';
import { useHydroLoginStatus } from '../composables/useHydroLoginStatus';

const props = defineProps<{ account: HydroLoginState }>();
const { tagType, label } = useHydroLoginStatus(() => props.account);
</script>

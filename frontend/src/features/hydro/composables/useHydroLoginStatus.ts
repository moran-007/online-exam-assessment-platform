import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import type { HydroLoginState } from '../models';

export function useHydroLoginStatus(account: MaybeRefOrGetter<HydroLoginState>) {
  const tagType = computed(() => {
    const status = toValue(account).lastLoginStatus;
    if (status === 'success') return 'success';
    if (status === 'blocked') return 'danger';
    if (status) return 'warning';
    return 'info';
  });
  const label = computed(() => {
    const current = toValue(account);
    if (current.lastLoginStatus === 'success') return '登录正常';
    if (current.lastLoginStatus === 'blocked') return '需要人机验证';
    if (current.lastLoginStatus) return current.lastLoginMessage || '登录异常';
    return '未检测';
  });
  return { tagType, label };
}

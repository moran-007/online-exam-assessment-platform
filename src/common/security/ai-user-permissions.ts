export const AI_USER_ROLE_CODE = 'ai_user';
export const AI_USER_ROLE_NAME = 'AI 用户';

const AI_READABLE_EXACT_PERMISSIONS = new Set([
  'attachment:preview',
  'ai.summary.view-own',
  'ai.summary.view-class',
]);

export function isAiReadablePermission(code: string) {
  return code.startsWith('ai.data.')
    || code.endsWith(':read')
    || code.endsWith('.read')
    || code.endsWith(':download')
    || AI_READABLE_EXACT_PERMISSIONS.has(code);
}

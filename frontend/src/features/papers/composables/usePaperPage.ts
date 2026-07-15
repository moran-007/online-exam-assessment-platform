import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Bottom, Check, Close, Delete, DocumentCopy, Edit, Plus, Refresh, Top, Upload } from '@element-plus/icons-vue';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import {
  paperStatusOptions as rawPaperStatusOptions,
  statusLabel,
  statusTagType,
} from '../../../statusMeta';
import { usePaperPageState } from './usePaperPageState';
import { usePaperPresentation } from './usePaperPresentation';
import { usePaperCatalog } from './usePaperCatalog';
import { usePaperEditor } from './usePaperEditor';

export function usePaperPage() {
  const router = useRouter();
  const state = usePaperPageState();
  const responsive = useResponsiveColumns();
  const presentation = usePaperPresentation(state);
  const paperStatusOptions = rawPaperStatusOptions as Array<{
    label: string;
    value: string;
    type: 'success' | 'info' | 'warning' | 'primary' | 'danger';
    description: string;
  }>;

  function syncSelectedQuestionScore() {
    return editor.syncSelectedQuestionScore();
  }

  function loadBulkKnowledgeTree() {
    return editor.loadBulkKnowledgeTree();
  }

  function changePaperStatus(row: unknown, status: string) {
    return editor.changePaperStatus(row, status);
  }

  function answerPaper(row?: unknown) {
    return editor.answerPaper(row);
  }

  function refreshSelectedPaper() {
    return catalog.refreshSelectedPaper();
  }

  const catalog = usePaperCatalog({
    state,
    decoratePaperDetail: presentation.decoratePaperDetail,
    syncSelectedQuestionScore,
    loadBulkKnowledgeTree,
    changePaperStatus,
    answerPaper,
  });
  const editor = usePaperEditor({
    state,
    router,
    canEditSnapshot: presentation.canEditSnapshot,
    snapshotEditTip: presentation.snapshotEditTip,
    snapshot: presentation.snapshot,
    paperScopeForStatus: presentation.paperScopeForStatus,
    refreshSelectedPaper,
  });

  onMounted(() => void catalog.loadAll());

  return {
    Bottom, Check, Close, Delete, DocumentCopy, Edit, Plus, Refresh, Top, Upload,
    router, paperStatusOptions, statusLabel, statusTagType, ...state, ...responsive,
    ...presentation, ...catalog, ...editor,
  };
}

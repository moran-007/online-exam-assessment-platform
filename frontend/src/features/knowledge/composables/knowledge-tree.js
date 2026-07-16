export function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    raw: item,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

export function countKnowledgeNodes(items) {
  return items.reduce((sum, item) => sum + 1 + countKnowledgeNodes(item.children ?? []), 0);
}

export function flattenKnowledgePoints(items) {
  return items.flatMap((item) => [item, ...flattenKnowledgePoints(item.children ?? [])]);
}

export function makeKnowledgeCodeBase(value) {
  const ascii = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return ascii || 'kp';
}

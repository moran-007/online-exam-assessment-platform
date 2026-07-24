import { computed, ref } from 'vue';

const STORAGE_KEY = 'academic-operation-classrooms-v1';
const classrooms = ref<string[]>(readClassrooms());

export function useClassroomCatalog() {
  const options = computed(() => classrooms.value.map((name) => ({ label: name, value: name })));

  function add(name: string) {
    const value = name.trim();
    if (!value || classrooms.value.includes(value)) return false;
    classrooms.value = [...classrooms.value, value];
    persist();
    return true;
  }

  function rename(previous: string, name: string) {
    const value = name.trim();
    if (!value || (value !== previous && classrooms.value.includes(value))) return false;
    classrooms.value = classrooms.value.map((item) => item === previous ? value : item);
    persist();
    return true;
  }

  function remove(name: string) {
    classrooms.value = classrooms.value.filter((item) => item !== name);
    persist();
  }

  return { classrooms, options, add, rename, remove };
}

function readClassrooms() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

function persist() {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(classrooms.value));
}

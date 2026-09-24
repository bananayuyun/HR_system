<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Icon from './Icon.vue';
const props = defineProps({
  orgs: Array,
  modelValue: String,
  editable: Boolean,
  collapsed: Boolean,
});
const emit = defineEmits(['update:modelValue', 'collapse', 'add', 'edit', 'delete', 'move-up', 'move-down']);
const menu = ref(null),
  menuElement = ref();
async function showMenu(event, row) {
  const rect = event.currentTarget.getBoundingClientRect();
  menu.value = { row, x: 0, y: 0 };
  await nextTick();
  if (!menu.value || !menuElement.value) return;
  const { width, height } = menuElement.value.getBoundingClientRect();
  menu.value.x = Math.max(8, Math.min(innerWidth - width - 8, rect.right - width));
  menu.value.y = Math.max(8, Math.min(innerHeight - height - 8, rect.bottom + 8));
}
function menuAction(action) {
  const row = menu.value?.row;
  menu.value = null;
  emit(action, row);
}
function dismiss(event) {
  if (
    event.key === 'Escape' ||
    (event.type === 'pointerdown' && !event.target.closest('.org-menu'))
  )
    menu.value = null;
}
onMounted(() => {
  window.addEventListener('pointerdown', dismiss);
  window.addEventListener('keydown', dismiss);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismiss);
  window.removeEventListener('keydown', dismiss);
});
const search = ref(''),
  open = ref(new Set(['ORG_ROOT']));
watch(
  () => props.modelValue,
  (id) => {
    const seen = new Set();
    let current = props.orgs.find((o) => o.id === id);
    while (current?.parent && !seen.has(current.parent)) {
      seen.add(current.parent);
      open.value.add(current.parent);
      current = props.orgs.find((o) => o.id === current.parent);
    }
  },
);
const depth = (o) => {
  let n = 0,
    p = o.parent,
    seen = new Set([o.id]);
  while (p && !seen.has(p)) {
    seen.add(p);
    n++;
    p = props.orgs.find((x) => x.id === p)?.parent;
  }
  return n;
};
function visible(o) {
  if (search.value)
    return props.orgs.some((match) => {
      if (!match.name.includes(search.value.trim())) return false;
      const seen = new Set();
      let current = match;
      while (current && !seen.has(current.id)) {
        if (current.id === o.id) return true;
        seen.add(current.id);
        current = props.orgs.find((x) => x.id === current.parent);
      }
      return false;
    });
  let p = o.parent;
  const seen = new Set();
  while (p && !seen.has(p)) {
    seen.add(p);
    if (props.orgs.some((x) => x.id === p) && !open.value.has(p)) return false;
    p = props.orgs.find((x) => x.id === p)?.parent;
  }
  return true;
}
const items = computed(() => {
  const rows = [];
  const seen = new Set();
  function visit(parent) {
    props.orgs
      .filter((o) => (o.parent || '') === parent)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.id.localeCompare(b.id))
      .forEach((o) => {
        if (seen.has(o.id)) return;
        seen.add(o.id);
        if (visible(o)) rows.push(o);
        visit(o.id);
      });
  }
  visit('');
  return rows;
});
function toggle(id) {
  if (open.value.has(id)) open.value.delete(id);
  else open.value.add(id);
}
</script>
<template>
  <aside v-if="!collapsed" class="v-org">
    <div :class="editable ? 'w3-org-search' : 'roster-org-search'">
      <label class="w-search-field">
        <input v-model="search" class="inp" placeholder="搜索组织" aria-label="搜索组织" />
        <Icon name="search" />
      </label>
      <button
        v-if="editable"
        class="btn w-iconbtn pri-btn"
        aria-label="新增组织"
        @click="showMenu($event, null)"
      >
        <Icon name="plus" />
      </button>
    </div>
    <div
      v-for="o in items"
      :key="o.id"
      class="w3-org-row"
      :style="{ 'padding-left': depth(o) * 24 + 'px', '--org-depth': depth(o) * 24 + 'px' }"
    >
      <button
        class="w3-tree-expander"
        :aria-label="(open.has(o.id) ? '收起' : '展开') + o.name"
        :aria-expanded="open.has(o.id)"
        :disabled="!orgs.some((x) => x.parent === o.id)"
        @click="toggle(o.id)"
      >
        <span v-if="orgs.some((x) => x.parent === o.id)" class="w3-org-caret" />
      </button>
      <button
        :class="{ on: modelValue === o.id || (!modelValue && !o.parent) }"
        @click="emit('update:modelValue', o.id)"
      >
        <span class="company-org-icon" :class="{ 'is-root': !o.parent }" aria-hidden="true">{{
          !o.parent ? '总' : depth(o) > 1 ? '组' : '部'
        }}</span
        >{{ o.name }}</button
      >
      <button
        v-if="editable"
        class="w-tool"
        :aria-label="o.name + '组织操作'"
        @click="showMenu($event, o)"
        >⋮</button
      >
    </div>
  </aside>
  <button
    class="w3-tree-collapse"
    :aria-label="collapsed ? '展开组织' : '收起组织'"
    :title="collapsed ? '展开组织' : '收起组织'"
    :aria-expanded="!collapsed"
    @click="emit('collapse')"
  >
    <Icon name="e993" />
  </button>
  <Teleport to="body"
    ><div
      v-if="menu"
      ref="menuElement"
      class="w3-popover w3-menu org-menu"
      :style="{ position: 'fixed', left: menu.x + 'px', top: menu.y + 'px', zIndex: 2100 }"
      role="menu"
      ><button v-if="!menu.row" class="w-select-option" @click="menuAction('add')">部门</button
      ><template v-else
        ><button class="w-select-option" @click="menuAction('edit')">编辑</button
        ><button v-if="menu.row.parent" class="w-select-option" @click="menuAction('move-up')">上移</button
        ><button v-if="menu.row.parent" class="w-select-option" @click="menuAction('move-down')">下移</button
        ><button v-if="menu.row.parent" class="w-select-option" @click="menuAction('delete')"
          >删除</button
        ></template
      ></div
    ></Teleport
  >
</template>

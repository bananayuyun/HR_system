<script setup>
import { ref, computed } from 'vue';
import { db } from '../store';
import { api } from '../api';
import { dictionaryLabels } from '../config/schema';
import Icon from './Icon.vue';
import DialogFrame from './DialogFrame.vue';
const emit = defineEmits(['saved']);
const tab = ref('workRegion'),
  search = ref(''),
  query = ref(''),
  dialog = ref(null),
  name = ref(''),
  busy = ref(false),
  error = ref('');
const rows = computed(() =>
  (db.baseSettings[tab.value] || []).filter((r) => r.name.includes(query.value)),
);
function refs(row) {
  const alias = { workRegion: 'location', workplace: 'office', contractCompany: 'company' }[
    tab.value
  ];
  return ['emps', 'jobs', 'reqs', 'candidates', 'orgs', 'assets'].reduce(
    (sum, k) =>
      sum + db[k].filter((r) => r[tab.value] === row.name || r[alias] === row.name).length,
    0,
  );
}
function edit(row) {
  dialog.value = { kind: 'edit', row };
  name.value = row?.name || '';
  error.value = '';
}
async function save() {
  error.value = '';
  let items = JSON.parse(JSON.stringify(db.baseSettings[tab.value] || []));
  const d = dialog.value;
  if (d.kind === 'edit') {
    if (!name.value.trim()) {
      error.value = '请输入名称。';
      return;
    }
    if (d.row) {
      items.find((x) => x.id === d.row.id).name = name.value.trim();
    } else items.push({ name: name.value.trim(), status: '启用', aliases: [] });
  } else if (d.kind === 'toggle')
    items.find((x) => x.id === d.row.id).status = d.row.status === '启用' ? '停用' : '启用';
  if (d.kind === 'delete' && refs(d.row)) {
    error.value = '该选项已被业务记录引用，请停用或先调整关联记录。';
    return;
  }
  busy.value = true;
  try {
    await api(
      '/settings/' + tab.value + (d.kind === 'delete' ? '/' + d.row.id : ''),
      d.kind === 'delete' ? { method: 'DELETE' } : { method: 'PUT', body: { items } },
    );
    dialog.value = null;
    emit('saved', '基础信息已保存');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="v-tabs"
    ><button
      v-for="(label, key) in dictionaryLabels"
      :key="key"
      :class="{ on: tab === key }"
      @click="
        tab = key;
        query = '';
        search = '';
      "
      >{{ label }}<small>{{ db.baseSettings[key]?.length || 0 }}</small></button
    ></div
  ><div class="v-hint"
    >统一用于花名册、招聘需求和相关导入。工作片区与工作所在地独立维护；停用项保留历史记录，仅供查询。</div
  ><div class="w-toolbar settings-toolbar" style="margin-bottom: 8px"
    ><input
      v-model="search"
      class="inp"
      :aria-label="'搜索' + dictionaryLabels[tab]"
      :placeholder="'搜索' + dictionaryLabels[tab]"
      style="width: 248px"
      @keyup.enter="query = search"
    /><button class="btn w-iconbtn pri-btn" aria-label="查询" @click="query = search"
      ><Icon name="search" /></button
    ><button
      class="btn w-iconbtn"
      aria-label="重置"
      @click="
        search = '';
        query = '';
      "
      ><Icon name="reset" /></button
    ><button class="btn pri-btn" @click="edit()">新增{{ dictionaryLabels[tab] }}</button></div
  ><div class="tw settings-table" style="flex: none; overflow: visible"
    ><table class="tbl" style="width: 100%; min-width: 600px"
      ><thead
        ><tr
          ><th style="width: 80px">序号</th><th>{{ dictionaryLabels[tab] }}</th
          ><th style="width: 100px">状态</th><th style="width: 120px">引用记录</th
          ><th style="width: 240px">操作</th></tr
        ></thead
      ><tbody
        ><tr v-for="(r, i) in rows" :key="r.id"
          ><td>{{ i + 1 }}</td
          ><td>{{ r.name }}</td
          ><td
            ><span class="v-badge" :class="{ blue: r.status === '启用' }">{{ r.status }}</span></td
          ><td>{{ refs(r) }}</td
          ><td
            ><button class="v-link" @click="edit(r)">编辑</button> <span class="v-sep" />
            <button
              class="v-link"
              @click="
                dialog = { kind: 'toggle', row: r };
                error = '';
              "
              >{{ r.status === '启用' ? '停用' : '启用' }}</button
            >{{ ' ' }}<span class="v-sep" /><button
              class="v-link"
              @click="
                dialog = { kind: 'delete', row: r };
                error = '';
              "
              >删除</button
            ></td
          ></tr
        ><tr v-if="!rows.length"><td colspan="5">暂无匹配项</td></tr></tbody
      ></table
    ></div
  ><DialogFrame
    v-if="dialog"
    :title="
      (dialog.kind === 'edit'
        ? dialog.row
          ? '编辑'
          : '新增'
        : dialog.kind === 'delete'
          ? '删除'
          : dialog.row.status === '启用'
            ? '停用'
            : '启用') + dictionaryLabels[tab]
    "
    narrow
    :error="error"
    :busy="busy"
    :dirty="dialog.kind === 'edit' && name !== (dialog.row?.name || '')"
    @close="dialog = null"
    ><div v-if="dialog.kind === 'edit'" class="v-form"
      ><div class="v-field"
        ><label><i>*</i>{{ dictionaryLabels[tab] }}</label
        ><input
          v-model="name"
          class="inp"
          :aria-label="dictionaryLabels[tab]"
          maxlength="80"
          required
        /><p v-if="dialog.row" class="v-hint"
          >重命名会同步已有记录。原名称仍可用于匹配旧版导入表。</p
        ></div
      ></div
    ><template v-else
      ><p
        >确定{{
          dialog.kind === 'delete' ? '删除' : dialog.row.status === '启用' ? '停用' : '启用'
        }}“{{ dialog.row.name }}”吗？</p
      ><p v-if="dialog.kind === 'toggle' && dialog.row.status === '启用'" class="v-muted"
        >已有记录不变；新增和变更时不能选择此项。</p
      ></template
    ><template #footer="{ requestClose }"
      ><button class="btn" :disabled="busy" @click="requestClose">取消</button
      ><button class="btn pri-btn" :disabled="busy" @click="save">确定</button></template
    ></DialogFrame
  >
</template>

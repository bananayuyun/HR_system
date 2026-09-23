<script setup>
import { computed, onMounted, ref } from 'vue';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import { api } from '../api';
import { db, deptName, reqName } from '../store';

const emit = defineEmits(['close', 'saved']);
const busy = ref(false),
  loading = ref(true),
  error = ref(''),
  showMessages = ref(false);
const form = ref({ enabled: '启用', workdays: '工作日', times: ['10:00', '14:00', '17:00'] });
const initial = ref('');
const dirty = computed(() => JSON.stringify(form.value) !== initial.value);
const splitNames = (value) => [
  ...new Set(
    String(value || '')
      .split(/[、,，]/)
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

function loadRules(rules = {}) {
  const times = Array.isArray(rules.times)
    ? rules.times.filter(Boolean).slice(0, 3)
    : ['10:00', '14:00', '17:00'];
  form.value = {
    enabled: rules.enabled === false ? '停用' : '启用',
    workdays: rules.workdays === false ? '每天' : '工作日',
    times: [...times, '', '', ''].slice(0, 3),
  };
  initial.value = JSON.stringify(form.value);
}
loadRules(db.rules);
onMounted(async () => {
  try {
    const rules = await api('/settings/reminders');
    db.rules = rules;
    loadRules(rules);
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
});

// The final prototype override groups both HR and departmental queues; paused
// requests and held candidates are not removed by the older reminder guard.
const groups = computed(() => {
  const grouped = new Map();
  for (const candidate of db.candidates) {
    if (!['待 HR 筛选', '待部门筛选', '暂缓筛选', '待筛选'].includes(candidate.stage)) continue;
    const request = db.reqs.find((row) => row.id === candidate.req);
    const step =
      candidate.screeningStep || (candidate.stage === '待部门筛选' ? 'department' : 'hr');
    const role = ['department', 'dept'].includes(step) ? 'screener' : 'owner';
    const people = splitNames(
      request?.[role] ||
        (request?.[role + 'Ids'] || [])
          .map((id) => db.emps.find((employee) => employee.id === id)?.name)
          .filter(Boolean)
          .join('、'),
    );
    for (const person of people) {
      const key = candidate.dept + '|' + person;
      if (!grouped.has(key)) grouped.set(key, { key, dept: candidate.dept, person, rows: [] });
      const group = grouped.get(key);
      if (!group.rows.some((row) => row.id === candidate.id)) group.rows.push(candidate);
    }
  }
  return [...grouped.values()].map((group) => ({
    ...group,
    requests: [...new Set(group.rows.map((candidate) => reqName(candidate.req)))].join('、'),
  }));
});

async function save() {
  if (busy.value || loading.value) return;
  error.value = '';
  if (!['启用', '停用'].includes(form.value.enabled)) {
    error.value = '请选择提醒开关。';
    return;
  }
  if (!['工作日', '每天'].includes(form.value.workdays)) {
    error.value = '请选择发送日期。';
    return;
  }
  const times = form.value.times.map((time) => String(time || '').trim()).filter(Boolean);
  if (!form.value.times[0] || !times.length) {
    error.value = '请填写第一个提醒时间。';
    return;
  }
  if (times.length > 3 || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    error.value = '请配置最多 3 个有效提醒时间。';
    return;
  }
  if (new Set(times).size !== times.length) {
    error.value = '提醒时间不能重复。';
    return;
  }
  busy.value = true;
  try {
    const rules = await api('/settings/reminders', {
      method: 'PUT',
      body: {
        enabled: form.value.enabled === '启用',
        workdays: form.value.workdays === '工作日',
        times: times.sort(),
      },
    });
    db.rules = rules;
    loadRules(rules);
    emit('saved', '提醒规则已保存；当前未连接钉钉，未发送任何通知。');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <DialogFrame
    title="待筛选简历 · 钉钉提醒规则"
    wide
    :busy="busy || loading"
    :error="error"
    :dirty="dirty"
    @close="emit('close')"
  >
    <form @submit.prevent="save">
      <div class="v-hint"
        >按招聘需求绑定的筛选负责人汇总，每个时间点发送一条待办摘要。只提醒仍待处理的简历，处理完成后不再提醒；同一负责人、同一时间点只发送一次。</div
      >
      <div class="v-form">
        <div class="v-field">
          <label for="field-reminderEnabled"><i>*</i>提醒开关</label>
          <FieldControl
            v-model="form.enabled"
            name="reminderEnabled"
            label="提醒开关"
            type="select"
            :options="['启用', '停用']"
            :disabled="busy || loading"
            required
          />
        </div>
        <div class="v-field">
          <label for="field-reminderWorkdays"><i>*</i>发送日期</label>
          <FieldControl
            v-model="form.workdays"
            name="reminderWorkdays"
            label="发送日期"
            type="select"
            :options="['工作日', '每天']"
            :disabled="busy || loading"
            required
          />
        </div>
        <div class="v-field full">
          <label for="field-reminderTime0">每日提醒时间（最多 3 次）</label>
          <div class="v-reminder-times">
            <FieldControl
              v-for="(_, index) in form.times"
              :key="index"
              v-model="form.times[index]"
              :name="'reminderTime' + index"
              :label="'提醒时间 ' + (index + 1)"
              type="time"
              :required="index === 0"
              :disabled="busy || loading"
            />
          </div>
          <span class="help">新录入的简历从当天下一个时间点开始提醒，无待处理简历时不发送。</span>
        </div>
      </div>
      <h4 class="sec-h">收件人预览</h4>
      <div id="reminder-preview">
        <table class="v-mini-table">
          <thead
            ><tr
              ><th>所属部门</th><th>筛选负责人</th><th>待处理简历</th><th>对应招聘需求</th></tr
            ></thead
          >
          <tbody>
            <tr v-for="group in groups" :key="group.key"
              ><td>{{ deptName(group.dept) }}</td
              ><td>{{ group.person }}</td
              ><td>{{ group.rows.length }} 份</td><td>{{ group.requests }}</td></tr
            >
            <tr v-if="!groups.length"><td colspan="4">暂无待处理简历，不发送提醒。</td></tr>
          </tbody>
        </table>
        <template v-if="showMessages">
          <div v-for="group in groups" :key="group.key" class="v-evaluation">
            <strong>待筛选简历提醒 · {{ group.person }}</strong>
            <p
              >{{ deptName(group.dept) }} 当前有
              {{ group.rows.length }} 份简历待处理，请进入“招聘管理 / 简历筛选”查看。{{
                group.requests
              }}。</p
            >
            <span class="v-muted">链接携带部门与招聘需求筛选条件；访问时仍校验主管权限。</span>
          </div>
        </template>
      </div>
      <div class="v-hint"
        >连接状态：未接入钉钉。此页面仅保存提醒规则及预览消息，不向任何人发送真实通知。</div
      >
    </form>
    <template #footer="{ requestClose }">
      <button class="btn" :disabled="busy || loading" @click="requestClose">关闭</button>
      <button class="btn" :disabled="busy || loading" @click="showMessages = true">预览消息</button>
      <button class="btn pri-btn" :disabled="busy || loading" @click="save">{{
        busy ? '保存中…' : '确定'
      }}</button>
    </template>
  </DialogFrame>
</template>

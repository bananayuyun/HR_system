<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import { api } from '../api';
import { db, user, can, within, topDept, deptName, reqCapacity } from '../store';
import { entityLabels, entitySections, employeeSections, sensitiveFields } from '../config/schema';
const props = defineProps({ type: String, row: Object, section: String, initial: Object });
const emit = defineEmits(['close', 'saved']);
const busy = ref(false),
  error = ref(''),
  form = ref(),
  frame = ref(),
  confirmDelete = ref(false),
  initial = ref('');
const assetMode = ref('基本信息');
const today = new Date().toLocaleDateString('sv-SE');
const data = ref({
  ...{
    status:
      props.type === 'reqs'
        ? '招聘中'
        : props.type === 'emps'
          ? '试用'
          : props.type === 'assets'
            ? '闲置'
            : '启用',
    workType: '全职',
    type: '新增',
    headcount: 1,
    count: 1,
    level: 1,
    min: 0,
    cost: 0,
    public: '否',
    entry: today,
    source: '手工新增',
    scope: '全部部门',
    dept: user.value?.departmentId || '',
    owner: '',
    contractType: '固定期限',
    grade: props.type === 'emps' ? db.grades.find((g) => g.status === '启用')?.code : '',
  },
  ...JSON.parse(JSON.stringify(props.row || {})),
  ...props.initial,
});
if (!data.value.workRegion) data.value.workRegion = data.value.location || '';
if (props.type === 'emps') {
  data.value.supervisor = props.row?.supervisorId ?? data.value.supervisor ?? '';
  data.value.graduated = data.value.graduated || data.value.graduation || '';
}
if (props.type === 'emps' && !props.row) {
  data.value.gender = '女';
  data.value.education = '待核对';
  data.value.dept = props.initial?.dept || '';
}
if (!data.value.contractCompany)
  data.value.contractCompany =
    data.value.company ||
    (props.type === 'reqs'
      ? db.baseSettings.contractCompany?.find((x) => x.status === '启用')?.name
      : '') ||
    '';
if (props.type === 'jobs' && !data.value.mainDept)
  data.value.mainDept = topDept(data.value.dept)?.id || data.value.dept;
if (props.type === 'reqs')
  for (const key of ['ownerIds', 'screenerIds', 'firstIds', 'secondIds'])
    data.value[key] = Array.isArray(data.value[key]) ? data.value[key] : [];
if (props.type === 'orgs' && props.row?.manager && !props.row.managerId)
  data.value.managerId = '__unbound__';
if (props.type === 'orgs') {
  data.value.orgType = data.value.orgType || (props.row?.id === 'ORG_ROOT' ? '公司' : '部门');
  if (!props.row)
    data.value.parent = data.value.parent || props.initial?.parent || db.orgs[0]?.id || '';
}
const assetModes = computed(() =>
  !props.row
    ? []
    : [
        '基本信息',
        ...(props.row.public === '是'
          ? []
          : [
              ...(props.row.status === '闲置' && !props.row.owner ? ['领用'] : []),
              ...(props.row.status === '使用中' && props.row.owner ? ['转移'] : []),
              ...(props.row.owner ? ['归还'] : []),
            ]),
      ],
);
const workHistory = ref(JSON.parse(JSON.stringify(props.row?.workHistory || [])));
const isHistory = computed(() => props.type === 'emps' && props.section === 'history');
const sections = computed(() => {
  if (props.type === 'assets' && assetMode.value !== '基本信息')
    return [
      [
        '',
        [
          ...(assetMode.value === '归还'
            ? []
            : [
                {
                  key: 'owner',
                  label: '使用人',
                  type: 'select',
                  required: true,
                  options: db.emps
                    .filter(
                      (e) =>
                        !e.deletedAt &&
                        !e.archived &&
                        !e.deleted &&
                        !['待离职', '已离职'].includes(e.status) &&
                        e.id !== props.row.owner,
                    )
                    .map((e) => ({
                      value: e.id,
                      label: e.name + ' / ' + e.id + ' · ' + deptName(e.dept),
                    })),
                },
              ]),
          {
            key: 'workRegion',
            label: assetMode.value === '归还' ? '归还地点' : '工作片区',
            type: 'select',
            required: true,
            options: (db.baseSettings.workRegion || [])
              .filter((x) => x.status === '启用')
              .map((x) => x.name),
          },
          {
            key: 'office',
            label: assetMode.value === '归还' ? '存放位置' : '使用位置',
            type: 'text',
            required: true,
          },
          { key: 'reason', label: '办理说明', type: 'textarea', required: true },
        ],
      ],
    ];
  if (props.section && props.type === 'emps') {
    const s = employeeSections.find((s) => s[0] === props.section);
    if (!s) return [];
    return [
      [
        '',
        s[2]
          .filter((f) => f[2] !== 'computed')
          .map(([key, label, type = 'text', options = []]) => ({
            key,
            label,
            type: ['org', 'job', 'person', 'grade'].includes(type) ? 'select' : type,
            required: ['name', 'dept', 'job', 'phone', 'entry'].includes(key),
            options:
              key === 'mainDept'
                ? db.orgs
                    .filter((x) => x.parent === 'ORG_ROOT')
                    .map((o) => ({ value: o.id, label: o.name }))
                : type === 'org'
                  ? db.orgs.map((o) => ({ value: o.id, label: o.name }))
                  : type === 'job'
                    ? db.jobs
                        .filter((j) => j.status === '启用')
                        .map((j) => ({ value: j.id, label: j.name }))
                    : type === 'person'
                      ? db.emps
                          .filter(
                            (e) =>
                              !e.deletedAt &&
                              !e.archived &&
                              !e.deleted &&
                              e.id !== props.row.id &&
                              e.status !== '已离职',
                          )
                          .map((e) => ({ value: e.id, label: e.name }))
                      : type === 'grade'
                        ? db.grades.filter((g) => g.status === '启用').map((g) => g.code)
                        : db.baseSettings[key]?.map((x) => ({
                            value: x.name,
                            label: x.name,
                            disabled: x.status !== '启用' && x.name !== data.value[key],
                          })) || options,
          })),
      ],
    ];
  }
  return entitySections(props.type, data.value, db);
});
function options(field) {
  if (field.key === 'parent' && props.type === 'orgs')
    return props.row
      ? field.options.filter((o) => !within(o.value, props.row.id))
      : field.options.filter((o) => o.value === data.value.parent);
  if (field.key === 'job')
    return !data.value.dept
      ? []
      : field.options.filter((o) => {
          const j =
            db.jobs.find((j) => j.id === o.value) ||
            (props.row?.job === o.value ? db.jobHistory.find((job) => job.id === o.value) : null);
          return (
            j &&
            (props.type === 'reqs' ? within(j.dept, data.value.dept) : j.dept === data.value.dept)
          );
        });
  if (field.key === 'mainDept')
    return field.options.filter(
      (o) => db.orgs.find((x) => x.id === o.value)?.parent === 'ORG_ROOT',
    );
  if (
    field.key === 'dept' &&
    data.value.mainDept &&
    (props.type === 'jobs' || (props.type === 'emps' && props.section === 'basic'))
  )
    return field.options
      .filter((o) => within(o.value, data.value.mainDept))
      .map((o) => ({
        ...o,
        label: o.value === data.value.mainDept ? '直属部门（无组别）' : o.label,
      }));
  if (field.key === 'grade')
    return field.options.filter((o) => {
      const code = typeof o === 'object' ? o.value : o,
        g = db.grades.find((g) => g.code === code);
      return (
        !g ||
        g.scope === '全部部门' ||
        within(data.value.dept, db.orgs.find((x) => x.name === g.scope)?.id)
      );
    });
  return field.options;
}
watch(
  () => data.value.dept,
  (val, old) => {
    if (val === old) return;
    const job = db.jobs.find((j) => j.id === data.value.job);
    if (job && !(props.type === 'reqs' ? within(job.dept, val) : job.dept === val))
      data.value.job = '';
    if (props.type === 'jobs') data.value.mainDept = topDept(val)?.id || val;
  },
);
watch(
  () => data.value.mainDept,
  (val, old) => {
    if (
      (props.type === 'jobs' || (props.type === 'emps' && props.section === 'basic')) &&
      old &&
      val !== old &&
      !within(data.value.dept, val)
    )
      data.value.dept = val;
  },
);
watch(
  () => data.value.req,
  (val) => {
    const r = db.reqs.find((r) => r.id === val);
    if (r)
      Object.assign(data.value, {
        dept: r.dept,
        job: r.job,
        workRegion: r.workRegion || r.location,
        workplace: r.workplace || r.office,
        contractCompany: r.contractCompany || r.company,
      });
  },
);
watch(
  () => data.value.public,
  (val) => {
    if (val === '是') data.value.owner = '';
  },
);
watch(
  () => data.value.owner,
  (id) => {
    if (props.type !== 'assets' || assetMode.value === '基本信息') return;
    const employee = db.emps.find((e) => e.id === id);
    if (employee) {
      data.value.workRegion = employee.workRegion || employee.location;
      data.value.office = employee.workplace || employee.office;
    }
  },
);
initial.value = JSON.stringify(data.value);
onMounted(async () => {
  if (
    props.type !== 'emps' ||
    !props.section ||
    !can('emps:sensitive') ||
    !sections.value.some(([, fields]) => fields.some((f) => sensitiveFields.has(f.key)))
  )
    return;
  busy.value = true;
  try {
    const sensitive = await api('/emps/' + encodeURIComponent(props.row.id) + '/sensitive');
    for (const [, fields] of sections.value)
      for (const field of fields)
        if (sensitiveFields.has(field.key)) data.value[field.key] = sensitive[field.key] || '';
    initial.value = JSON.stringify(data.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
});
const dirty = computed(
  () =>
    JSON.stringify(data.value) !== initial.value ||
    JSON.stringify(workHistory.value) !== JSON.stringify(props.row?.workHistory || []),
);
const historicalRequest = computed(
  () => props.type === 'reqs' && !!props.row?.historicalJobName && !props.row?.job,
);
const wide = computed(
  () =>
    !props.section &&
    ['emps', 'reqs', 'jobs', 'candidates'].includes(props.type) &&
    !(props.type === 'candidates' && props.row),
);
const title = computed(() =>
  props.type === 'candidates' && props.row
    ? '编辑候选信息'
    : props.type === 'assets' && props.row
      ? '编辑资产 · ' + props.row.name
      : props.section
        ? '编辑' + (employeeSections.find((x) => x[0] === props.section)?.[1] || '工作经历')
        : (props.row ? '编辑' : '新增') + entityLabels[props.type],
);
function changeMode(mode, discard = false) {
  if (mode === assetMode.value) return;
  if (dirty.value && !discard) {
    frame.value.confirmDiscard(() => changeMode(mode, true));
    return;
  }
  assetMode.value = mode;
  data.value = {
    ...JSON.parse(JSON.stringify(props.row)),
    workRegion: props.row.workRegion || props.row.location,
    owner: mode === '基本信息' ? props.row.owner : '',
    office: mode === '归还' ? '资产库房' : props.row.office,
    reason: '',
  };
  initial.value = JSON.stringify(data.value);
  error.value = '';
}
const capacity = computed(() =>
  props.type === 'reqs' ? reqCapacity(props.row, data.value) : null,
);
async function save() {
  if (historicalRequest.value) return;
  error.value = '';
  if (!form.value.reportValidity()) return;
  for (const [, fields] of sections.value)
    for (const f of fields) {
      const v = data.value[f.key];
      if (
        f.required &&
        (v === undefined ||
          v === null ||
          String(v).trim() === '' ||
          (Array.isArray(v) && !v.length))
      ) {
        error.value = '请填写' + f.label;
        return;
      }
    }
  if (props.type === 'reqs' && capacity.value?.over) {
    error.value =
      '当前需求超出岗位编制 ' + capacity.value.over + ' 人，请调整需求人数或先补充岗位编制。';
    return;
  }
  const payload = {};
  for (const [, fields] of sections.value)
    for (const f of fields) {
      const value = data.value[f.key];
      if (sensitiveFields.has(f.key) && (!can('emps:sensitive') || /[*•]/.test(String(value))))
        continue;
      payload[f.key] = typeof value === 'string' ? value.trim() : value;
    }
  if (payload.managerId === '__unbound__') delete payload.managerId;
  if (props.row) payload.version = props.row.version;
  if (isHistory.value) payload.workHistory = workHistory.value;
  if (payload.workRegion !== undefined) payload.location = payload.workRegion;
  if (payload.workplace !== undefined && props.type !== 'assets')
    payload.office = payload.workplace;
  if (payload.contractCompany !== undefined) payload.company = payload.contractCompany;
  if (payload.dept) payload.mainDept = topDept(payload.dept)?.id || payload.dept;
  if (props.type === 'emps') {
    if (payload.supervisor !== undefined) payload.supervisorId = payload.supervisor;
    if (payload.graduated !== undefined) payload.graduation = payload.graduated;
    if (payload.mainDept !== undefined) payload.mainDeptId = payload.mainDept;
  }
  if (props.type === 'candidates') {
    const r = db.reqs.find((r) => r.id === payload.req);
    if (r) {
      payload.dept = r.dept;
      payload.job = r.job;
    }
  }
  if (payload.phone && !/^1\d{10}$/.test(payload.phone)) {
    error.value = '请填写 11 位手机号。';
    return;
  }
  if (payload.salaryMin && Number(payload.salaryMin) > Number(payload.salaryMax)) {
    error.value = '最高月薪不能低于最低月薪。';
    return;
  }
  if (payload.contractEnd && payload.contractStart && payload.contractEnd < payload.contractStart) {
    error.value = '合同结束日期不能早于开始日期。';
    return;
  }
  const transaction = props.type === 'assets' && assetMode.value !== '基本信息';
  if (transaction) payload.location = payload.workRegion;
  const url =
    '/' +
    props.type +
    (props.row ? '/' + encodeURIComponent(props.row.id) : '') +
    (transaction
      ? '/actions/' + { 领用: 'assign', 转移: 'transfer', 归还: 'return' }[assetMode.value]
      : '');
  busy.value = true;
  try {
    const result = await api(url, {
      method: transaction ? 'POST' : props.row ? 'PUT' : 'POST',
      body: payload,
    });
    emit(
      'saved',
      transaction
        ? '资产' + assetMode.value + '已完成'
        : (props.row ? '已保存' : '已新增') + entityLabels[props.type],
      result,
    );
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function removeRequest() {
  if (props.type !== 'reqs' || !props.row || props.row.status !== '已关闭') return;
  busy.value = true;
  error.value = '';
  try {
    await api('/reqs/' + encodeURIComponent(props.row.id), {
      method: 'DELETE',
      body: { version: props.row.version },
    });
    emit('saved', '招聘需求已删除');
  } catch (e) {
    error.value = e.message;
    confirmDelete.value = false;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <DialogFrame
    ref="frame"
    :title="title"
    :wide="wide"
    :narrow="!wide"
    :error="error"
    :busy="busy"
    :dirty="dirty"
    :panel-class="section ? 'employee-section-editor' : ''"
    @close="emit('close')"
  >
    <div v-if="type === 'assets' && row" class="v-tabs" aria-label="资产编辑方式"
      ><button
        v-for="mode in assetModes"
        :key="mode"
        :class="{ on: mode === assetMode }"
        @click="changeMode(mode)"
        >{{ mode }}</button
      ></div
    >
    <form ref="form" id="edit-form" @submit.prevent="save">
      <div v-if="historicalRequest" class="v-hint req-historical-hint"
        >原岗位已删除，此历史招聘需求不能修改。已关闭的需求可在底部删除。</div
      >
      <p v-if="type === 'assets' && assetMode !== '基本信息'">{{ row.id }} · {{ row.model }}</p>
      <template v-if="isHistory"
        ><div v-for="(r, i) in workHistory" :key="i" class="form-section"
          ><h4 class="sec-h"
            >工作经历 {{ i + 1 }}
            <button type="button" class="v-link danger" @click="workHistory.splice(i, 1)"
              >删除</button
            ></h4
          ><div class="v-form"
            ><div
              v-for="f in [
                ['company', '就职公司', 'text'],
                ['start', '就职时间', 'date'],
                ['end', '离职时间', 'date'],
                ['reason', '离职原因', 'text'],
              ]"
              :key="f[0]"
              class="v-field"
              ><label>{{ f[1] }}</label
              ><FieldControl v-model="r[f[0]]" :type="f[2]" :label="f[1]" /></div></div></div
        ><button
          type="button"
          class="btn"
          @click="workHistory.push({ company: '', start: '', end: '', reason: '' })"
          >添加工作经历</button
        ></template
      >
      <template v-else
        ><section v-for="([label, fields], index) in sections" :key="index" class="form-section"
          ><h4 v-if="label" class="sec-h">{{ label }}</h4
          ><div class="v-form"
            ><div
              v-for="field in fields"
              :key="field.key"
              class="v-field"
              :class="{ full: field.type === 'textarea' }"
              ><label :for="'field-' + field.key"
                ><span
                  v-if="
                    field.required &&
                    ((type === 'jobs' && field.key === 'dept') ||
                      (['emps', 'reqs'].includes(type) && field.key === 'workRegion' && !section))
                  "
                  class="required"
                  >*</span
                ><i v-else-if="field.required">*</i>{{ field.label }}</label
              ><input
                v-if="historicalRequest && field.key === 'job'"
                class="inp"
                :value="row.historicalJobName"
                disabled
              /><FieldControl
                v-else
                v-model="data[field.key]"
                v-bind="field"
                :name="field.key"
                :placeholder="
                  type === 'orgs' && ['name', 'manager', 'managerPhone'].includes(field.key)
                    ? '请输入' + field.label
                    : undefined
                "
                :options="options(field)"
                :readonly="!!row && ['id', 'code'].includes(field.key)"
                :disabled="
                  busy ||
                  historicalRequest ||
                  (type === 'assets' && field.key === 'owner' && data.public === '是') ||
                  (type === 'emps' && sensitiveFields.has(field.key) && !can('emps:sensitive'))
                "
              /><span v-if="field.help" class="help">{{ field.help }}</span></div
            ></div
          ><div v-if="type === 'reqs' && index === 0 && capacity" id="req-capacity-check"
            ><section class="req-capacity-panel"
              ><h4 class="sec-h">编制校验</h4
              ><div class="req-capacity-metrics"
                ><span
                  >岗位编制 <b>{{ capacity.headcount }}</b></span
                ><span
                  >在编 <b>{{ capacity.occupied }}</b></span
                ><span
                  >其他招聘在途 <b>{{ capacity.otherInTransit }}</b></span
                ><span
                  >本次待招 <b>{{ capacity.currentInTransit }}</b></span
                ><span
                  >本次可用 <b>{{ capacity.available }}</b></span
                ></div
              ><div v-if="capacity.over" class="v-hint req-capacity-warning"
                ><b>超出岗位编制 {{ capacity.over }} 人。</b
                >请调整本次需求人数，或先在岗位管理中补充岗位编制。</div
              ><div v-else class="v-hint req-capacity-success"
                ><b>可招聘。</b>预计占用 {{ capacity.projected }} /
                {{ capacity.headcount }} 个岗位编制。</div
              ></section></div
          ></section
        ></template
      >
      <div v-if="type === 'orgs' && !row" class="v-hint"
        >组织编码由系统自动生成；可在编辑中维护负责人、启用状态和组织职责。</div
      >
    </form>
    <template #footer="{ requestClose }"
      ><template v-if="confirmDelete"
        ><span class="req-delete-confirm" role="status"
          >确定删除此招聘需求？关联候选人的招聘历史会保留。<template v-if="dirty"
            >未保存的修改将丢弃。</template
          ></span
        ><button class="btn" :disabled="busy" @click="confirmDelete = false">返回编辑</button
        ><button class="btn danger" :disabled="busy" @click="removeRequest">{{
          busy ? '删除中…' : '确认删除'
        }}</button></template
      ><template v-else
        ><template v-if="type === 'reqs' && row"
          ><div class="req-delete-action"
            ><button
              class="btn danger"
              :disabled="busy || row.status !== '已关闭'"
              :title="row.status !== '已关闭' ? '请先将状态改为已关闭并保存' : '删除招聘需求'"
              @click="confirmDelete = true"
              >删除</button
            ><span v-if="row.status !== '已关闭'" class="req-delete-help"
              >先关闭并保存后可删除</span
            ></div
          ></template
        ><button class="btn" :disabled="busy" @click="requestClose">{{
          historicalRequest ? '关闭' : '取消'
        }}</button
        ><button v-if="!historicalRequest" class="btn pri-btn" :disabled="busy" @click="save">{{
          busy ? '保存中…' : assetMode === '基本信息' ? '确定' : '确认' + assetMode
        }}</button></template
      ></template
    >
  </DialogFrame>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import DialogFrame from './DialogFrame.vue';
import FieldControl from './FieldControl.vue';
import Icon from './Icon.vue';
import { api, downloadFile } from '../api';
import {
  db,
  isHr,
  can,
  deptName,
  jobName,
  empName,
  reqName,
  topDept,
  jobStaffed,
  jobRecruiting,
  capacity,
  reqCapacity,
  reqArrived,
  lastInterview,
} from '../store';
import { employeeSections, schemas, sensitiveFields, materialTypes } from '../config/schema';
const props = defineProps({
  type: String,
  row: Object,
  route: String,
  editable: Boolean,
  initialTab: String,
});
const emit = defineEmits(['close', 'action', 'saved', 'tabChange']);
const tab = ref(props.initialTab || 'basic'),
  error = ref(''),
  busy = ref(false),
  revealed = ref({}),
  sectionId = ref(''),
  category = ref(materialTypes[0]),
  detail = ref(props.row),
  pendingFile = ref(null);
watch(tab, (value) => emit('tabChange', value));
watch(
  () => props.row,
  (v) => (detail.value = v),
);
const legacyCandidate = computed(
  () => props.type === 'candidates' && !['interviews', 'offers'].includes(props.route),
);
const employeeWritable = computed(() => can('emps:write') && detail.value.status !== '已离职');
const wide = computed(
  () => ['emps', 'jobs', 'grades', 'orgs'].includes(props.type) || legacyCandidate.value,
);
const title = computed(() =>
  props.type === 'emps'
    ? detail.value.status === '已离职'
      ? '离职人员档案'
      : '员工档案'
    : props.type === 'candidates'
      ? props.route === 'offers'
        ? '入职人员详情'
        : '候选人详情'
      : props.type === 'assets'
        ? '资产详情'
        : props.type === 'reqs'
          ? '招聘需求详情'
          : props.row.name || props.row.code,
);
const tabs = computed(() =>
  props.type === 'emps'
    ? [
        ['basic', '个人信息'],
        ['files', '档案材料'],
        ['timeline', '成长记录'],
        ['assets', '领用资产'],
      ]
    : props.type === 'candidates' && props.route === 'offers'
      ? [
          ['basic', '入职信息'],
          ['interviews', '面试记录'],
          ['history', '操作记录'],
        ]
      : props.type === 'candidates' && props.route === 'interviews'
        ? [
            ['basic', '简历信息'],
            ['interviews', '面试记录'],
          ]
        : props.type === 'candidates'
          ? [
              ['basic', '简历信息'],
              ['interviews', '面试记录'],
              ['entry', '录用信息'],
              ['history', '操作记录'],
            ]
          : [],
);
const files = computed(() => detail.value.files || []),
  assets = computed(() => db.assets.filter((a) => a.owner === detail.value.id));
const history = computed(() =>
  tab.value === 'timeline'
    ? detail.value.timeline || []
    : detail.value.history || detail.value.audit || [],
);
function value(key) {
  const e = detail.value;
  if (['dept', 'mainDept', 'secondaryDept', 'parent'].includes(key))
    return deptName(key === 'mainDept' ? e.mainDept || topDept(e.dept)?.id : e[key]);
  if (key === 'job') return jobName(e.job);
  if (key === 'supervisor') return e.supervisor ? empName(e.supervisor) : '—';
  if (key === 'age') {
    const d = new Date(revealed.value.birthday || e.birthday);
    return Number.isFinite(d.getTime())
      ? Math.floor((Date.now() - d) / 31557600000) + '岁'
      : e.sourceAge
        ? e.sourceAge + '岁'
        : '—';
  }
  if (key === 'birthMonth') {
    const d = new Date(revealed.value.birthday || e.birthday);
    return Number.isFinite(d.getTime())
      ? d.getMonth() + 1 + '月'
      : e.birthMonth
        ? e.birthMonth + '月'
        : '—';
  }
  if (key === 'tenureMonths')
    return e.entry ? Math.max(0, Math.floor((Date.now() - new Date(e.entry)) / 2629800000)) : '—';
  if (key === 'staffed') return jobStaffed(e);
  if (key === 'recruiting') return jobRecruiting(e);
  if (key === 'capacityState') return capacity(e).label;
  return e[key] ?? '—';
}
function action(name, extra) {
  emit('action', name, { ...detail.value, ...extra });
}
function jump(id) {
  sectionId.value = id;
  document
    .getElementById('employee-section-' + id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function reveal(key) {
  if (revealed.value[key]) {
    delete revealed.value[key];
    return;
  }
  busy.value = true;
  try {
    const data = await api('/emps/' + detail.value.id + '/sensitive');
    revealed.value[key] = data[key] || '—';
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  detail.value = await api('/' + props.type + '/' + encodeURIComponent(props.row.id));
}
async function upload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    error.value = '单个文件不能超过 20 MB。';
    return;
  }
  busy.value = true;
  try {
    const body = new FormData();
    body.append('file', file);
    body.append('category', category.value);
    await api('/' + props.type + '/' + detail.value.id + '/files', { method: 'POST', body });
    await reload();
    emit('saved', '文件已上传', false);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
    event.target.value = '';
  }
}
async function download(file) {
  try {
    await downloadFile('/' + props.type + '/files/' + file.id, file.name || file.fileName);
  } catch (e) {
    error.value = e.message;
  }
}
async function removeFile(file) {
  busy.value = true;
  try {
    await api('/' + props.type + '/files/' + file.id, { method: 'DELETE' });
    await reload();
    pendingFile.value = null;
    emit('saved', '文件已删除', false);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const genericFields = computed(() =>
  (schemas[props.route] || []).map((f) => [f.label, value(f.key)]),
);
const candidateFields = computed(() =>
  props.route === 'offers'
    ? [
        ['手机号码', detail.value.phone],
        ['电子邮箱', detail.value.email],
        ['岗位', jobName(detail.value.job)],
        ['当前状态', detail.value.stage],
        ['工作片区', detail.value.workRegion || detail.value.location],
        ['工作所在地', detail.value.workplace || detail.value.office],
        ['合同归属', detail.value.contractCompany || detail.value.company],
        ['计划入职日', detail.value.onboard],
        ['入职工号', detail.value.employeeId || '待入职后生成'],
        ['处理说明', detail.value.entryNotes],
      ]
    : [
        ['手机号码', detail.value.phone],
        ['电子邮箱', detail.value.email],
        ['最高学历', detail.value.education],
        ['毕业院校', detail.value.school],
        ['工作年限', detail.value.years + ' 年'],
        ['办公地点', detail.value.location],
        [legacyCandidate.value ? '来源' : '简历来源', detail.value.source],
        ...(legacyCandidate.value
          ? [
              ['筛选负责人', detail.value.screener],
              ['人员标签', detail.value.tags],
              ['录入日期', detail.value.created],
            ]
          : []),
      ],
);
const entryFields = computed(() => {
  const r = detail.value,
    req = db.reqs.find((q) => q.id === r.req);
  return [
    ['当前状态', r.stage],
    ['钉钉审批结果', '未接入'],
    ['审批单号', '—'],
    ['Offer 日期', '—'],
    ['计划入职日', r.onboard],
    ['合同归属', r.contractCompany || r.company || req?.contractCompany || req?.company],
    ['办公室 / 办事处', r.workplace || r.office || req?.workplace || req?.office],
    ['入职工号', r.employeeId],
    ['备注', r.entryNotes || r.offerNotes],
  ];
});
const assetFields = computed(() => [
  ['资产名称', detail.value.name],
  ['资产编码', detail.value.id],
  ['资产类别', detail.value.category],
  ['规格型号', detail.value.model],
  ['办公地点', detail.value.workRegion || detail.value.location],
  ['存放位置', detail.value.office],
  ['资产状态', detail.value.status],
  [
    '使用人',
    detail.value.public === '是'
      ? '公共资产'
      : detail.value.owner
        ? empName(detail.value.owner)
        : '未分配',
  ],
  ['购置日期', detail.value.purchased],
  ['购置金额', Number(detail.value.cost || 0).toLocaleString() + ' 元'],
  ['备注', detail.value.notes],
]);
const reqSections = computed(() => {
  const r = detail.value,
    q = reqCapacity(r),
    j = q?.job,
    capacityText = q
      ? q.over
        ? `编制不足，缺口 ${q.over} 人（预计占用 ${q.projected} / 编制 ${q.headcount}）`
        : `编制可用 ${q.available} 人（预计占用 ${q.projected} / 编制 ${q.headcount}）`
      : '—',
    cs = db.candidates.filter((c) => c.req === r.id),
    names = (ids) => ids?.map(empName).join('、');
  return [
    [
      '基本信息',
      [
        ['需求部门', deptName(r.dept)],
        ['招聘岗位', jobName(r.job)],
        ['岗位所属组织', deptName(j?.dept)],
        ['需求类型', r.type],
        ['需求人数', r.count + ' 人'],
        ['薪资区间', r.salaryMin && r.salaryMax ? `${r.salaryMin}–${r.salaryMax}K / 月` : '待补充'],
        ['编制校验', capacityText],
        ['期望到岗', r.deadline],
        ['合同归属', r.contractCompany || r.company],
        ['工作片区', r.workRegion || r.location],
        ['工作所在地', r.workplace || r.office],
      ],
    ],
    [
      '处理负责人',
      [
        ['HR 负责人', r.owner || names(r.ownerIds)],
        ['部门筛选负责人', r.screener || names(r.screenerIds)],
        ['初试面试官', r.first || names(r.firstIds)],
        ['复试面试官', r.second || names(r.secondIds)],
      ],
    ],
    [
      '候选人进度',
      [
        [
          '待筛选',
          cs.filter((c) => ['待 HR 筛选', '待部门筛选', '暂缓筛选'].includes(c.stage)).length +
            ' 人',
        ],
        ['面试中', cs.filter((c) => ['初试', '复试'].includes(c.stage)).length + ' 人'],
        ['已入职', cs.filter((c) => c.stage === '已入职').length + ' 人'],
      ],
    ],
  ];
});
const blue = (s) =>
  ['待 HR 筛选', '待部门筛选', '初试', '复试', '待入职', '招聘中', '启用', '试用'].includes(s);
</script>
<template>
  <DialogFrame
    :title="title"
    :wide="wide"
    :narrow="!wide"
    :employee="type === 'emps'"
    :panel-class="type === 'emps' ? 'employee-profile' : type === 'reqs' ? 'req-detail' : ''"
    :error="error"
    :busy="busy"
    @close="emit('close')"
  >
    <template v-if="type === 'emps'">
      <div class="employee-profile-head"
        ><div class="v-drawer-intro"
          ><h2
            >{{ detail.name }}
            <span v-if="detail.status === '已离职'" class="v-badge">已离职</span></h2
          ><span class="v-muted"
            >{{ detail.id }} · {{ deptName(detail.dept) }} · {{ jobName(detail.job) }}</span
          ></div
        ><div
          v-if="(can('exports:read') && can('emps:sensitive')) || can('audit:read')"
          class="v-drawer-actions"
          ><details class="employee-more"
            ><summary class="btn" tabindex="0">更多 <Icon name="down" /></summary
            ><div class="employee-more-menu"
              ><button
                v-if="can('exports:read') && can('emps:sensitive')"
                class="btn"
                @click="action('employeeExport')"
                >导出档案</button
              ><button v-if="can('audit:read')" class="btn" @click="action('audit')"
                >维护日志</button
              ></div
            ></details
          ></div
        ></div
      >
    </template>
    <div v-else-if="type === 'candidates'" class="v-drawer-intro"
      ><h2
        >{{ detail.name }}
        <span class="v-badge" :class="{ blue: blue(detail.stage) }">{{ detail.stage }}</span></h2
      ><span class="v-muted"
        >{{ legacyCandidate ? detail.id + ' · ' : '' }}{{ reqName(detail.req) }} ·
        {{ deptName(detail.dept) }}</span
      ></div
    >
    <div v-if="legacyCandidate && route !== 'screening'" class="v-drawer-actions"
      ><template v-if="['初试', '复试'].includes(detail.stage) && can('interviews:write')"
        ><button class="btn pri-btn" @click="action('schedule')">安排面试</button
        ><button class="btn" @click="action('interviewResult')">录入面试结果</button></template
      ><button
        v-if="
          ['待入职', '延期入职', '未到岗', '放弃入职', '取消入职'].includes(detail.stage) &&
          can('offers:write')
        "
        class="btn pri-btn"
        @click="action('onboarding')"
        >推进录用 / 入职</button
      ><button
        v-if="
          detail.stage !== '已入职' &&
          can('candidates:write') &&
          (isHr || !['待入职', '延期入职', '未到岗', '放弃入职', '取消入职'].includes(detail.stage))
        "
        class="btn"
        @click="action('edit')"
        >编辑候选信息</button
      ></div
    >
    <div v-if="tabs.length" class="v-tabs"
      ><button
        v-for="[key, label] in tabs"
        :key="key"
        :class="{ on: tab === key }"
        @click="tab = key"
        >{{ label }}</button
      ></div
    >
    <template v-if="type === 'emps' && tab === 'basic'">
      <div class="employee-section-jump"
        ><FieldControl
          :model-value="sectionId"
          type="select"
          :options="employeeSections.map((s) => ({ value: s[0], label: s[1] }))"
          placeholder="跳至档案模块"
          label="跳至档案模块"
          @change="jump"
      /></div>
      <div class="employee-information"
        ><nav class="employee-section-nav" aria-label="档案模块"
          ><button
            v-for="s in employeeSections"
            :key="s[0]"
            :class="{ on: sectionId === s[0] }"
            @click="jump(s[0])"
            >{{ s[1] }}</button
          ></nav
        ><div class="employee-section-content">
          <section
            v-for="section in employeeSections"
            :id="'employee-section-' + section[0]"
            :key="section[0]"
            class="employee-info-section"
            ><header
              ><h4 class="sec-h">{{ section[1] }}</h4
              ><button
                v-if="employeeWritable"
                class="v-link"
                :aria-label="'编辑' + section[1]"
                @click="action('sectionEdit', { section: section[0] })"
                >编辑</button
              ></header
            >
            <template v-if="section[0] === 'history'"
              ><div v-for="(h, i) in detail.workHistory || []" :key="i" class="employee-history"
                ><strong>工作经历 {{ i + 1 }}</strong
                ><dl class="employee-fields"
                  ><div
                    v-for="[label, val] in [
                      ['就职公司', h.company],
                      ['就职时间', h.start],
                      ['离职时间', h.end],
                      ['离职原因', h.reason],
                    ]"
                    :key="label"
                    ><dt>{{ label }}</dt
                    ><dd>{{ val || '—' }}</dd></div
                  ></dl
                ></div
              ><p v-if="!detail.workHistory?.length" class="v-muted">暂无工作经历</p></template
            >
            <dl v-else class="employee-fields"
              ><div
                v-for="[key, label] in section[2].filter(
                  ([key]) => key !== 'secondaryDept' || detail.secondaryDept,
                )"
                :key="key"
                ><dt>{{ label }}</dt
                ><dd v-if="sensitiveFields.has(key) && detail[key]"
                  ><span>{{ revealed[key] || value(key) }}</span>
                  <button v-if="can('emps:sensitive')" class="v-link" @click="reveal(key)">{{
                    revealed[key] ? '隐藏' : '显示'
                  }}</button></dd
                ><dd v-else>{{ value(key) || '—' }}</dd></div
              ></dl
            >
          </section>
        </div></div
      >
    </template>
    <template v-else-if="tab === 'files'"
      ><div class="employee-section-actions"
        ><span class="v-muted">档案材料 {{ files.length }} 份</span
        ><button v-if="employeeWritable" class="btn pri-btn" @click="action('employeeUpload')"
          >上传材料</button
        ></div
      ><div class="employee-material-list"
        ><div v-for="typeName in materialTypes" :key="typeName"
          ><span>{{ typeName }}</span
          ><span class="v-muted">{{
            files.filter((f) => f.category === typeName).length
              ? files.filter((f) => f.category === typeName).length + ' 份'
              : '未上传'
          }}</span
          ><button
            v-if="employeeWritable"
            class="v-link"
            @click="action('employeeUpload', { category: typeName })"
            >上传</button
          ></div
        ></div
      ><div class="v-hint">按材料类别维护员工档案，支持 PDF、图片和 Word。</div
      ><div v-for="file in files" :key="file.id" class="v-file-row"
        ><div
          ><b>{{ file.name || file.fileName }}</b
          ><div class="v-muted"
            >{{ file.category }} · {{ file.date?.slice(0, 10) }} ·
            {{ Math.ceil(file.size / 1024) }} KB</div
          ></div
        ><button class="v-link" @click="action('previewFile', { file })">预览</button
        ><button class="v-link" @click="download(file)">下载</button
        ><button v-if="employeeWritable" class="v-link" :disabled="busy" @click="pendingFile = file"
          >删除</button
        ></div
      ><div v-if="!files.length" class="v-empty"
        ><strong>暂无档案材料</strong>点击上方“上传材料”补充员工档案。</div
      ></template
    >
    <template v-else-if="tab === 'timeline' || tab === 'history'"
      ><div v-if="tab === 'timeline' && employeeWritable" class="employee-section-actions"
        ><span class="v-muted">成长记录 {{ history.length }} 条</span
        ><div class="employee-section-buttons"
          ><button class="btn" @click="action('timelineImport')">导入成长记录</button
          ><button class="btn pri-btn" @click="action('timeline')">新增成长记录</button></div
        ></div
      ><ol class="v-timeline"
        ><li v-for="(item, i) in history" :key="i"
          ><b>{{ item.title || item.type || item.action || '变更记录' }}</b
          ><span class="v-muted"
            >{{ item.date || item.createdAt }} · {{ item.operator || item.actorName }}</span
          ><p>{{ item.detail || item.reason || item.description }}</p
          ><div v-if="tab === 'timeline' && item.editable && employeeWritable"
            ><button class="v-link" @click="action('timelineEdit', { item })">编辑</button>
            <button class="v-link" @click="action('timelineDelete', { item })">删除</button></div
          ></li
        ></ol
      ><p v-if="!history.length" class="v-history-empty">暂无记录</p></template
    >
    <template v-else-if="tab === 'interviews' && legacyCandidate"
      ><div v-for="(iv, i) in detail.interviews || []" :key="iv.id || i" class="v-evaluation"
        ><strong>{{ iv.round }} · {{ iv.status }}</strong
        ><div class="v-muted"
          >{{ iv.date }} {{ iv.start }}–{{ iv.end }} · {{ iv.interviewer }} · {{ iv.method }}</div
        ><p>地点 / 链接：{{ iv.place }}</p
        ><p v-if="iv.evaluation">评价：{{ iv.evaluation }}</p
        ><p v-if="iv.result">结果：{{ iv.result }}</p
        ><p v-if="iv.cancelReason">取消原因：{{ iv.cancelReason }}</p
        ><div
          v-if="
            can('interviews:write') &&
            iv === lastInterview(detail) &&
            iv.round === detail.stage &&
            ['待面试', '待评价', '待改期'].includes(iv.status)
          "
          class="v-drawer-actions"
          ><button class="btn" @click="action('schedule')">修改安排</button
          ><button class="btn" @click="action('cancelInterview')">取消安排</button
          ><button class="btn pri-btn" @click="action('interviewResult')">填写评价</button></div
        ></div
      ><div v-if="!detail.interviews?.length" class="v-empty"
        ><strong>暂无面试记录</strong>筛选通过后可以安排初试。</div
      ></template
    >
    <template v-else-if="tab === 'interviews'"
      ><section
        v-for="(iv, i) in [...(detail.interviews || [])].reverse()"
        :key="iv.id || i"
        class="v-evaluation"
        ><strong>{{ iv.round }} · {{ iv.status }}</strong
        ><dl class="v-kv"
          ><template
            v-for="[label, val] in [
              ['面试日期', iv.date],
              ['面试时间', iv.start + '–' + iv.end],
              ['面试官', iv.interviewer],
              ['面试方式', iv.method],
              ['地点 / 链接', iv.place],
              ['面试结果', iv.result || '尚未录入'],
            ]"
            :key="label"
            ><dt>{{ label }}</dt
            ><dd>{{ val || '—' }}</dd></template
          ></dl
        ><template v-if="iv.votes?.length"
          ><h4 class="sec-h">面试官反馈</h4
          ><p v-for="(v, i) in iv.votes" :key="i"
            ><strong>{{ v.operator }}：{{ v.result }}</strong
            ><br />{{ v.evaluation }}<br /><span class="v-muted">{{ v.date }}</span></p
          ></template
        ><p v-else-if="iv.evaluation">备注：{{ iv.evaluation }}</p
        ><p v-if="iv.cancelReason">取消原因：{{ iv.cancelReason }}</p></section
      ><div v-if="!detail.interviews?.length" class="v-hint">暂无面试记录</div></template
    >
    <template v-else-if="tab === 'assets'"
      ><div v-for="a in assets" :key="a.id" class="v-file-row"
        ><div
          ><b>{{ a.name }}</b
          ><div class="v-muted">{{ a.id }} · {{ a.model }} · {{ a.office }}</div></div
        ><span class="v-badge" :class="{ blue: a.status === '使用中' }">{{ a.status }}</span
        ><button
          v-if="can('assets:write')"
          class="v-link"
          @click="emit('action', 'asset', { ...a, action: 'return', entityType: 'assets' })"
          >归还</button
        ><button
          v-if="can('assets:write') && a.status === '使用中'"
          class="v-link"
          @click="emit('action', 'asset', { ...a, action: 'transfer', entityType: 'assets' })"
          >转移</button
        ></div
      ><div v-if="!assets.length" class="v-empty"><strong>暂无领用资产</strong></div></template
    >
    <template v-else-if="type === 'candidates' && tab === 'entry'"
      ><dl class="v-kv"
        ><template v-for="[label, val] in entryFields" :key="label"
          ><dt>{{ label }}</dt
          ><dd>{{ val || '—' }}</dd></template
        ></dl
      ></template
    >
    <template v-else-if="type === 'candidates'"
      ><dl class="v-kv"
        ><template v-for="[label, val] in candidateFields" :key="label"
          ><dt>{{ label }}</dt
          ><dd>{{ val || '—' }}</dd></template
        ></dl
      ><template v-if="route !== 'offers'"
        ><h4 class="sec-h">简历摘要</h4
        ><p style="white-space: pre-wrap">{{ detail.notes || '暂无摘要' }}</p
        ><h4 class="sec-h">原始简历</h4
        ><div v-if="!files.length" class="v-hint">{{
          legacyCandidate ? '暂无简历附件。可批量录入自有简历进行预览。' : '暂无简历附件'
        }}</div
        ><div v-for="file in files" :key="file.id" class="v-file-row"
          ><div
            ><b>{{ file.name || file.fileName }}</b
            ><div class="v-muted"
              >{{ file.category || '简历附件' }} · {{ file.date?.slice(0, 10) }} ·
              {{ Math.ceil(file.size / 1024) }} KB</div
            ></div
          ><button class="v-link" @click="action('previewFile', { file })">预览</button
          ><button class="v-link" @click="download(file)">下载</button></div
        ></template
      ></template
    >
    <template v-else-if="type === 'reqs'"
      ><div class="req-detail-heading"
        ><h2>{{ detail.name }}</h2
        ><span class="v-badge" :class="{ blue: blue(detail.status) }">{{
          detail.status
        }}</span></div
      ><section v-for="[label, fields] in reqSections" :key="label" class="req-detail-section"
        ><h4 class="sec-h">{{ label }}</h4
        ><dl class="req-detail-fields"
          ><template v-for="[key, val] in fields" :key="key"
            ><dt>{{ key }}</dt
            ><dd>{{ val ?? '—' }}</dd></template
          ></dl
        ></section
      ><section class="req-detail-section"
        ><h4 class="sec-h">招聘说明</h4><p>{{ detail.description || '暂无说明' }}</p></section
      ><dl class="req-detail-fields"
        ><dt>数据来源</dt><dd>{{ detail.source }}</dd></dl
      ></template
    >
    <template v-else-if="type === 'assets'"
      ><h4 class="sec-h">资产信息</h4
      ><dl class="v-kv"
        ><template v-for="[label, val] in assetFields" :key="label"
          ><dt>{{ label }}</dt
          ><dd>{{ val || '—' }}</dd></template
        ></dl
      ><h4 class="sec-h">变更记录</h4
      ><ol class="v-timeline"
        ><li v-for="(item, i) in detail.history || []" :key="i"
          ><b>{{ item.type || item.detail }}</b
          ><span class="v-muted">{{ item.date }} · {{ item.operator }}</span
          ><p>{{ item.detail }}</p></li
        ></ol
      ></template
    >
    <template v-else
      ><dl class="v-kv"
        ><template v-for="[label, val] in genericFields" :key="label"
          ><dt>{{ label }}</dt
          ><dd>{{ val || '—' }}</dd></template
        ></dl
      ><template v-if="type === 'jobs'"
        ><h4 class="sec-h">岗位职责</h4><p>{{ detail.duties || '—' }}</p
        ><h4 class="sec-h">任职要求</h4><p>{{ detail.requirements || '—' }}</p></template
      ><template v-if="type === 'grades'"
        ><h4 class="sec-h">任职要求</h4><p>{{ detail.requirements || '—' }}</p></template
      ></template
    >
    <div v-if="pendingFile" class="w3-leave-confirm"
      ><section
        ><h3>删除档案材料</h3><p>确定删除“{{ pendingFile.name }}”吗？</p
        ><footer
          ><button class="btn" :disabled="busy" @click="pendingFile = null">取消</button
          ><button class="btn pri-btn" :disabled="busy" @click="removeFile(pendingFile)"
            >确定</button
          ></footer
        ></section
      ></div
    >
    <template #footer>
      <template v-if="type === 'candidates' && route === 'screening' && editable"
        ><button class="btn" @click="emit('close')">关闭</button
        ><button class="btn" @click="action('screening', { result: '暂缓' })">暂缓筛选</button
        ><button class="btn danger" @click="action('screening', { result: '未通过' })"
          >筛选不通过</button
        ><button class="btn" @click="action('screening', { result: '候选人取消' })"
          >候选人取消</button
        ><button class="btn pri-btn" @click="action('screening')">{{
          isHr ? 'HR 筛选' : '部门筛选'
        }}</button></template
      >
      <template v-else-if="type === 'candidates' && route === 'offers' && can('offers:write')"
        ><button class="btn" @click="emit('close')">关闭</button
        ><button
          v-if="['待入职', '延期入职', '未到岗'].includes(detail.stage)"
          class="btn danger"
          @click="action('cancelOnboarding')"
          >取消入职</button
        ><button class="btn pri-btn" @click="action('onboarding')">{{
          ['待入职', '延期入职'].includes(detail.stage) ? '确认入职' : '办理'
        }}</button></template
      >
      <template v-else-if="type === 'emps'"
        ><button class="btn" @click="emit('close')">关闭</button
        ><button
          v-if="can('emps:write')"
          class="btn"
          @click="action(detail.status === '已离职' ? 'reinstate' : 'leave')"
          >{{ detail.status === '已离职' ? '复职' : '办理离职' }}</button
        ><button
          v-if="can('emps:write') && detail.status === '已离职'"
          class="btn danger"
          @click="action('permanentDelete')"
          >彻底删除</button
        ></template
      >
      <template v-else
        ><button
          v-if="editable && ['jobs', 'grades'].includes(type)"
          class="btn"
          @click="action('delete')"
          >删除</button
        ><button class="btn" @click="emit('close')">关闭</button
        ><button
          v-if="editable && !['emps', 'candidates'].includes(type)"
          class="btn pri-btn"
          @click="action('edit')"
          >编辑</button
        ></template
      >
    </template>
  </DialogFrame>
</template>

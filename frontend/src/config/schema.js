import metadata from './prototype-metadata.json';
export const employeeSections = metadata.employeeSections;
export const schemas = { ...metadata.schemas, deptscreening: metadata.schemas.screening };
export const routes = {
  roster: ['员工花名册', '员工管理', 'emps'],
  orgs: ['组织管理', '员工管理', 'orgs'],
  jobs: ['岗位管理', '员工管理', 'jobs'],
  grades: ['职级体系', '员工管理', 'grades'],
  settings: ['基础信息设置', '员工管理', 'baseSettings'],
  reqs: ['招聘需求', '招聘管理', 'reqs'],
  pool: ['简历库', '招聘管理', 'candidates'],
  screening: ['简历筛选', '招聘管理', 'candidates'],
  deptscreening: ['部门筛选', '招聘管理', 'candidates'],
  interviews: ['面试管理', '招聘管理', 'candidates'],
  offers: ['入职管理', '招聘管理', 'candidates'],
  assets: ['资产台账', '资产管理', 'assets'],
};
export const entityLabels = {
  emps: '员工',
  orgs: '组织',
  jobs: '岗位',
  grades: '职级',
  reqs: '招聘需求',
  candidates: '候选人',
  assets: '资产',
};
export const dictionaryLabels = {
  workRegion: '工作片区',
  workplace: '工作所在地',
  contractCompany: '合同归属',
};
export const PRE_ENTRY = ['待入职', '延期入职', '未到岗', '放弃入职', '取消入职'];
export const employeeTypes = ['全职', '兼职', '实习', '劳务派遣', '其它'];
export const sensitiveFields = new Set([
  'identityNumber',
  'idNumber',
  'idNo',
  'bankNumber',
  'bankAccount',
  'fundAccount',
  'socialAccount',
  'socialSecurityNo',
  'nativePlace',
  'identityAddress',
  'householdLocation',
  'householdType',
  'address',
  'emergency',
  'emergencyPhone',
  'birthday',
  'identityExpiry',
  'identityName',
  'idName',
  'emergencyRelation',
  'firstWork',
  'socialCity',
]);
export const materialTypes = [
  '身份证（人像面）',
  '身份证（国徽面）',
  '学历证书',
  '学位证书',
  '员工照片',
  '原单位离职证明',
  '体检报告',
  '员工登记表',
  '身份证复印件',
  '离职证明',
  '劳动合同',
  '知识产权及保密协议',
  '其他文档',
];
const f = (key, label, type = 'text', required = false, options = [], help = '') => ({
  key,
  label,
  type,
  required,
  options,
  help,
});
export function entitySections(type, row, db) {
  const dict = (k) =>
    (db.baseSettings?.[k] || [])
      .filter((x) => x.status === '启用' || x.name === row[k])
      .map((x) => ({ value: x.name, label: x.name + (x.status === '停用' ? '（已停用）' : '') }));
  const orgs = db.orgs
    .filter((x) => x.status === '启用' || x.id === row.dept)
    .map((x) => ({ value: x.id, label: x.name }));
  const people = db.emps
    .filter(
      (e) => !e.deletedAt && !e.archived && !e.deleted && !['已离职', '待离职'].includes(e.status),
    )
    .map((e) => ({ value: e.id, label: e.name + ' / ' + e.id }));
  const reqPeople = (idsKey, nameKey) => {
    const result = [...people],
      labels = String(row[nameKey] || '').split('、');
    for (const [i, id] of (row[idsKey] || []).entries())
      if (!result.some((x) => x.value === id))
        result.push({ value: id, label: (labels[i] || '原负责人') + ' / ' + id });
    return result;
  };
  const orgManagers = [
    { value: '', label: '未设置' },
    ...people,
    ...((!row.managerId || row.managerId === '__unbound__') && row.manager
      ? [{ value: '__unbound__', label: row.manager }]
      : []),
  ];
  const names = db.emps
    .filter((e) => !e.deletedAt && !e.archived && !e.deleted && e.status !== '已离职')
    .map((e) => ({ value: e.name, label: e.name + ' / ' + e.id }));
  const jobs = db.jobs
    .filter((j) => j.status === '启用' || j.id === row.job)
    .map((j) => ({ value: j.id, label: j.name }));
  const archivedJob = db.jobHistory?.find((j) => j.id === row.job && j.deletedAt);
  if (archivedJob) jobs.push({ value: archivedJob.id, label: `${archivedJob.name}（已归档）` });
  const geography = [
    f('workRegion', '工作片区', 'select', true, dict('workRegion')),
    f('workplace', '工作所在地', 'select', true, dict('workplace')),
    f('contractCompany', '合同归属', 'select', type === 'reqs', dict('contractCompany')),
  ];
  const config = {
    emps: [
      [
        '基本信息',
        [
          f('id', '工号', 'text', true),
          f('name', '姓名', 'text', true),
          f('phone', '手机号', 'tel', true),
          f('email', '邮箱', 'email'),
          f('gender', '性别', 'select', false, ['女', '男', '未填写']),
          f('education', '最高学历', 'select', false, [
            '博士',
            '硕士',
            '本科',
            '大专',
            '其它',
            '待核对',
          ]),
          f('school', '毕业院校'),
          f('major', '专业'),
          geography[1],
          geography[2],
          f('archiveNumber', '档案编号'),
        ],
      ],
      [
        '任职信息',
        [
          f('dept', '所属组织', 'select', true, orgs),
          f('job', '岗位', 'select', true, jobs),
          f(
            'grade',
            '职级',
            'select',
            false,
            db.grades.filter((g) => g.status === '启用').map((g) => g.code),
          ),
          f('salaryBand', '薪资档位', 'number'),
          geography[0],
          f('status', '员工状态', 'select', true, ['试用', '正式', '待离职']),
          f('workType', '用工类型', 'select', false, employeeTypes),
          f('entry', '入职日期', 'date', true),
          f('regular', '计划转正日期', 'date'),
          f('tags', '人员标签', 'text', false, [], '多个标签以逗号分隔'),
          f('source', '数据来源', 'select', false, ['手工新增', '钉钉导入', '招聘入职']),
        ],
      ],
      [
        '合同与联系信息',
        [
          f('contractStart', '合同开始日期', 'date'),
          f('contractEnd', '合同结束日期', 'date'),
          f('emergency', '紧急联系人'),
          f('emergencyPhone', '紧急联系电话', 'tel'),
          f('notes', '备注', 'textarea'),
        ],
      ],
      [
        '任职补充',
        [
          f('supervisor', '直属上级', 'select', false, [
            { value: '', label: '无直属上级' },
            ...people,
          ]),
          f('skills', '技能'),
          f('contractType', '合同类型', 'select', false, [
            '固定期限',
            '无固定期限',
            '项目合同',
            '其它',
          ]),
        ],
      ],
    ],
    orgs: row.id
      ? [
          [
            '基本信息',
            [
              f('name', '组织名称', 'text', true),
              f('id', '组织编码', 'text', true, [], '组织编码创建后不可修改'),
              f(
                'orgType',
                '组织类型',
                'select',
                true,
                row.id === 'ORG_ROOT' ? ['公司'] : ['部门', '组'],
              ),
              f('parent', '上级组织', 'select', row.id !== 'ORG_ROOT', [
                { value: '', label: '无上级组织' },
                ...orgs.filter((o) => o.value !== row.id),
              ]),
            ],
          ],
          [
            '管理信息',
            [
              f('managerId', '负责人', 'select', false, orgManagers),
              f('managerPhone', '负责人电话', 'tel'),
              f(
                'status',
                '启用状态',
                'select',
                true,
                row.id === 'ORG_ROOT' ? ['启用'] : ['启用', '停用'],
              ),
              f('description', '组织职责', 'textarea'),
            ],
          ],
        ]
      : [
          [
            '基本信息',
            [
              f('name', '组织名称', 'text', true),
              f('parent', '上级组织', 'select', true, orgs),
              f('orgType', '组织类型', 'select', true, ['部门', '组']),
              f('manager', '负责人'),
              f('managerPhone', '负责人电话', 'tel'),
            ],
          ],
        ],
    jobs: [
      [
        '',
        [
          f('name', '岗位名称', 'text', true),
          f('mainDept', '所属部门', 'select', true, orgs),
          f('dept', '所属组织', 'select', true, orgs),
          f('headcount', '岗位编制', 'number', true),
          f('status', '岗位状态', 'select', true, ['启用', '停用']),
          f('duties', '岗位职责', 'textarea', true),
          f('requirements', '任职要求', 'textarea', true),
        ],
      ],
    ],
    grades: [
      [
        '',
        [
          f('sequence', '职务序列', 'select', true, db.sequences || []),
          f('code', '职级编码', 'text', true, [], '如 M1、T2、S1；编码在体系内唯一'),
          f('name', '职级名称', 'text', true),
          f('level', '对应层级', 'number', true),
          f('scope', '适用组织', 'select', true, ['全部部门', ...db.orgs.map((o) => o.name)]),
          f('min', '参考经验年限', 'number'),
          f('status', '状态', 'select', true, ['启用', '停用']),
          f('requirements', '任职要求', 'textarea', true),
        ],
      ],
    ],
    reqs: [
      [
        '招聘需求',
        [
          f('name', '需求名称', 'text', true),
          f('dept', '需求部门', 'select', true, orgs),
          f('job', '招聘岗位', 'select', true, jobs),
          f('type', '需求类型', 'select', true, ['新增', '替补']),
          f('count', '需求人数', 'number', true),
          f('deadline', '期望到岗日期', 'date', true),
          f('salaryMin', '最低月薪（K）', 'number', true),
          f('salaryMax', '最高月薪（K）', 'number', true),
          ...geography,
          f('status', '需求状态', 'select', true, ['招聘中', '暂停', '已完成', '已关闭']),
        ],
      ],
      [
        '处理负责人',
        [
          f('ownerIds', 'HR 负责人', 'multi', true, reqPeople('ownerIds', 'owner')),
          f('screenerIds', '部门筛选负责人', 'multi', true, reqPeople('screenerIds', 'screener')),
          f('firstIds', '初试面试官', 'multi', true, reqPeople('firstIds', 'first')),
          f('secondIds', '复试面试官', 'multi', true, reqPeople('secondIds', 'second')),
          f('description', '招聘说明', 'textarea'),
        ],
      ],
    ],
    candidates: row.id
      ? [
          [
            '',
            [
              f('name', '姓名', 'text', true),
              f('phone', '手机号', 'tel', true),
              f('email', '邮箱', 'email'),
              f('education', '最高学历', 'select', false, [
                '博士',
                '硕士',
                '本科',
                '大专',
                '其它',
                '待核对',
              ]),
              f('school', '毕业院校'),
              f('years', '工作年限', 'number'),
              f('tags', '人员标签', 'text', false, [], '多个标签以逗号分隔，入职后带入员工档案'),
              f('notes', '简历摘要 / 备注', 'textarea'),
            ],
          ],
        ]
      : [
          [
            '简历信息',
            [
              f(
                'req',
                '招聘需求',
                'select',
                true,
                db.reqs
                  .filter((r) => r.status === '招聘中' || r.id === row.req)
                  .map((r) => ({ value: r.id, label: r.name })),
              ),
              f('name', '姓名', 'text', true),
              f('phone', '手机号', 'tel', true),
              f('email', '邮箱', 'email'),
              f('education', '最高学历', 'select', true, [
                '博士',
                '硕士',
                '本科',
                '大专',
                '其它',
                '待核对',
              ]),
              f('school', '毕业院校'),
              f('years', '工作年限', 'number', true),
              f('source', '简历来源', 'select', true, ['Boss 直聘', '内部推荐', '猎聘', '其它']),
              ...geography,
              f('tags', '标签'),
              f('notes', '简历说明', 'textarea'),
            ],
          ],
        ],
    assets: [
      [
        '',
        [
          f('id', '资产编码', 'text', true),
          f('name', '资产名称', 'text', true),
          f('category', '资产类别', 'select', true, ['电子设备', '办公家具', '其它']),
          f('model', '规格型号', 'text', true),
          f('workRegion', '工作片区', 'select', true, dict('workRegion')),
          f('office', '存放位置', 'text', true),
          f('public', '是否公共资产', 'select', true, ['否', '是']),
          f('owner', '使用人', 'select', false, [{ value: '', label: '未分配' }, ...people]),
          f('status', '资产状态', 'select', true, ['闲置', '使用中', '维修中', '已报废']),
          f('purchased', '购置日期', 'date'),
          f('cost', '购置金额（元）', 'number'),
          f('notes', '备注', 'textarea'),
        ],
      ],
    ],
  };
  return config[type] || [];
}

package cn.hrplatform;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class HrService {
  final Db db;
  final Scope scope;
  final Audit audit;
  final Crypto crypto;
  static final Set<String> SENSITIVE =
      Set.of(
          "identityNumber",
          "idNumber",
          "idNo",
          "bankNumber",
          "bankAccount",
          "fundAccount",
          "socialAccount",
          "socialSecurityNo",
          "nativePlace",
          "identityAddress",
          "householdLocation",
          "householdType",
          "address",
          "emergency",
          "emergencyPhone",
          "birthday",
          "identityExpiry",
          "identityName",
          "idName",
          "emergencyRelation",
          "firstWork",
          "socialCity");
  static final Set<String> READONLY =
      Set.of(
          "dbId",
          "version",
          "stableId",
          "deleted",
          "deletedAt",
          "deletedBy",
          "previousStatus",
          "timeline",
          "history",
          "audit",
          "files",
          "interviews",
          "employeeId",
          "candidateId",
          "created_at",
          "updated_at",
          "password_hash",
          "extra");
  static final Set<String> EXTRA_FIELDS =
      Set.of(
          "sequence",
          "scope",
          "orgType",
          "manager",
          "managerPhone",
          "workRegion",
          "workplace",
          "contractCompany",
          "regular",
          "actualRegular",
          "source",
          "sourceIndex",
          "sourceAge",
          "sourceTenure",
          "birthMonth",
          "tags",
          "skills",
          "notes",
          "description",
          "school",
          "major",
          "office",
          "pendingDepartment",
          "pendingGroup",
          "pendingJob",
          "department",
          "group",
          "contractGrade",
          "salaryBand",
          "entryNotes",
          "screeningStep",
          "held",
          "returned",
          "approval",
          "educationDetail",
          "materialMedical",
          "materialRegistration",
          "materialIdentity",
          "materialLeaving",
          "materialContract",
          "materialNda",
          "materialOther",
          "marriage",
          "nativeCity",
          "profileIncomplete",
          "photo",
          "workType",
          "verification");

  HrService(Db db, Scope scope, Audit audit, Crypto crypto) {
    this.db = db;
    this.scope = scope;
    this.audit = audit;
    this.crypto = crypto;
  }

  public Db database() {
    return db;
  }

  public Scope dataScope() {
    return scope;
  }

  public Audit auditor() {
    return audit;
  }

  public Map<String, Object> bootstrap(Actor a) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("user", a.view());
    for (String t : List.of("orgs", "jobs", "grades", "emps", "reqs", "candidates", "assets"))
      out.put(t, list(a, t, !t.equals("grades")));
    if (!a.can("roster:read")) out.put("emps", employeeDirectory(a));
    out.put("sequences", sequences());
    out.put("baseSettings", settings());
    out.put(
        "rules",
        db.object(
            db.one("SELECT value_json FROM sys_setting WHERE setting_key='rules'")
                .get("value_json")));
    return out;
  }

  public List<String> sequences() {
    var setting = db.one("SELECT value_json FROM sys_setting WHERE setting_key='sequences'");
    if (setting != null) {
      try {
        List<?> values = db.json.readValue(Db.str(setting, "value_json"), List.class);
        return values.stream().map(Db::text).toList();
      } catch (Exception e) {
        throw new IllegalStateException("Invalid saved sequence configuration", e);
      }
    }
    return db.jdbc.queryForList(
        "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(extra,'$.sequence')) FROM grade WHERE"
            + " deleted_at IS NULL AND JSON_EXTRACT(extra,'$.sequence') IS NOT NULL",
        String.class);
  }

  // Recruitment forms need a small people picker even when the roster is unavailable.
  private List<Map<String, Object>> employeeDirectory(Actor a) {
    Set<Long> allowed = scope.orgs(a);
    if (allowed.isEmpty()) return List.of();
    String placeholders = String.join(",", Collections.nCopies(allowed.size(), "?"));
    return db.jdbc.queryForList(
            "SELECT e.employee_no id,e.name,o.code dept,j.code job,"
                + " CASE e.status WHEN 'PROBATION' THEN '试用'"
                + " WHEN 'PENDING_LEAVE' THEN '待离职' ELSE '正式' END status"
                + " FROM employee e JOIN org_department o ON o.id=e.org_id"
                + " LEFT JOIN job_position j ON j.id=e.job_id"
                + " LEFT JOIN org_department m ON m.id=e.main_org_id"
                + " WHERE e.deleted_at IS NULL AND e.status IN ('PROBATION','ACTIVE','PENDING_LEAVE')"
                + " AND (e.org_id IN (" + placeholders + ")"
                + " OR m.name REGEXP '人事|人力|行政') ORDER BY e.name,e.id",
            allowed.toArray());
  }

  public List<Map<String, Object>> list(Actor a, String type, boolean archived) {
    return queryList(a, type, archived ? "1=1" : "deleted_at IS NULL");
  }

  public List<Map<String, Object>> archived(Actor a, String type) {
    return queryList(a, type, "deleted_at IS NOT NULL");
  }

  private List<Map<String, Object>> queryList(Actor a, String type, String deletionClause) {
    var spec = EntitySchema.get(type);
    if (!a.can(spec.readPermission())
        && !(type.equals("candidates")
            && (a.can("screening:read") || a.can("interviews:read") || a.can("offers:read"))))
      return List.of();
    Set<Long> allowed = scope.orgs(a);
    String where = deletionClause;
    List<Object> parameters = new ArrayList<>();
    if (!a.all() && !type.equals("grades")) {
      if (allowed.isEmpty()) return List.of();
      String placeholders = String.join(",", Collections.nCopies(allowed.size(), "?"));
      String filter =
          type.equals("orgs")
              ? "id IN (" + placeholders + ")"
              : type.equals("candidates")
                  ? "request_id IN (SELECT id FROM recruitment_request WHERE org_id IN ("
                      + placeholders
                      + "))"
                  : "org_id IN (" + placeholders + ")";
      where += " AND " + filter;
      parameters.addAll(allowed);
    }
    return db
        .jdbc
        .queryForList(
            "SELECT * FROM " + spec.table() + " WHERE " + where + " ORDER BY "
                + (type.equals("orgs") ? "sort_order,id" : "id"),
            parameters.toArray())
        .stream()
        .map(r -> view(type, r))
        .toList();
  }

  boolean inScope(Actor a, String type, Map<String, Object> r, Set<Long> allowed) {
    if (a.all() || type.equals("grades")) return true;
    Long org = org(type, r);
    return org != null && allowed.contains(org);
  }

  Long org(String type, Map<String, Object> r) {
    if (type.equals("orgs")) return Db.num(r.get("id"));
    if (type.equals("grades")) return null;
    if (type.equals("candidates")) {
      var req = db.one("SELECT org_id FROM recruitment_request WHERE id=?", r.get("request_id"));
      return req == null ? null : Db.num(req.get("org_id"));
    }
    return r.get("org_id") == null ? null : Db.num(r.get("org_id"));
  }

  Map<String, Object> raw(Actor a, String type, String code, boolean lock) {
    var s = EntitySchema.get(type);
    var r =
        db.one(
            "SELECT * FROM "
                + s.table()
                + " WHERE "
                + s.code()
                + "=?"
                + (lock ? " FOR UPDATE" : ""),
            code);
    if (r == null) throw new ApiException(404, "记录不存在。");
    Long org = org(type, r);
    if (!a.all() && !type.equals("grades")) {
      if (org == null) {
        audit.denied(a, type, Db.num(r.get("id")));
        throw new ApiException(403, "记录不在当前数据范围内。");
      }
      scope.check(a, org);
    }
    return r;
  }

  public Map<String, Object> get(Actor a, String type, String code) {
    if (!type.equals("candidates") ||
        !(a.can("screening:read") || a.can("interviews:read") || a.can("offers:read")))
      audit.require(a, EntitySchema.get(type).readPermission());
    var row = raw(a, type, code, false);
    var result = view(type, row);
    if (a.can("audit:read")) result.put("audit", auditEntries(type, Db.num(row.get("id"))));
    return result;
  }

  public List<Map<String, Object>> auditEntries(String type, long id) {
    return db
        .jdbc
        .queryForList(
            "SELECT l.id,l.action,l.created_at,l.before_json,l.after_json,u.display_name actor_name"
                + " FROM audit_log l LEFT JOIN sys_user u ON u.id=l.actor_user_id WHERE"
                + " l.resource_type=? AND l.resource_id=? ORDER BY l.id DESC LIMIT 200",
            type,
            id)
        .stream()
        .map(
            row -> {
              var before = canonicalAuditSnapshot(db.object(row.get("before_json")));
              var after = canonicalAuditSnapshot(db.object(row.get("after_json")));
              Set<String> keys = new LinkedHashSet<>(before.keySet());
              keys.addAll(after.keySet());
              List<Map<String, Object>> changes = new ArrayList<>();
              for (String key : keys) {
                if (key.equals("sensitiveFieldsChanged")) {
                  if (after.get(key) instanceof List<?> fields)
                    for (Object field : fields)
                      changes.add(
                          Db.map(
                              "field",
                              field,
                              "label",
                              "敏感字段 " + field,
                              "before",
                              "已隐藏",
                              "after",
                              "已修改"));
                  continue;
                }
                if (Set.of("id", "version", "created_at", "updated_at", "fields").contains(key)
                    || key.contains("cipher")
                    || SENSITIVE.contains(key)) continue;
                Object old = before.get(key), value = after.get(key);
                if (!Objects.equals(old, value))
                  changes.add(
                      Db.map(
                          "field",
                          key,
                          "label",
                          fieldLabel(key),
                          "before",
                          auditValue(key, old),
                          "after",
                          auditValue(key, value)));
              }
              return Db.map(
                  "id",
                  row.get("id"),
                  "action",
                  actionLabel(type, Db.str(row, "action")),
                  "type",
                  actionLabel(type, Db.str(row, "action")),
                  "date",
                  stringDate(row.get("created_at")),
                  "createdAt",
                  stringDate(row.get("created_at")),
                  "actorName",
                  row.get("actor_name"),
                  "operator",
                  row.get("actor_name"),
                  "detail",
                  changes.isEmpty()
                      ? "操作已记录"
                      : String.join("、", changes.stream().map(c -> Db.str(c, "label")).toList())
                          + "已更新",
                  "changes",
                  changes);
            })
        .toList();
  }

  String actionLabel(String type, String action) {
    return switch (action) {
      case "LEAVE" -> "离职";
      case "REINSTATE" -> "复职";
      case "PERMANENT_DELETE" -> "彻底删除";
      case "SENSITIVE_READ" -> "查看敏感信息";
      case "ARCHIVE" -> type.equals("emps") ? "离职" : "删除";
      case "RESTORE" -> type.equals("emps") ? "复职" : "恢复";
      case "CREATE" -> "新增";
      case "UPDATE" -> "资料变更";
      default -> action;
    };
  }

  String fieldLabel(String field) {
    return switch (field) {
      case "name" -> "姓名 / 名称";
      case "remark", "notes" -> "备注";
      case "description" -> "描述";
      case "employee_no" -> "工号";
      case "org_id" -> "直属组织";
      case "main_org_id" -> "主部门";
      case "secondary_org_id" -> "兼任部门";
      case "job_id" -> "岗位";
      case "grade_id" -> "职级";
      case "location" -> "工作片区";
      case "workplace" -> "工作所在地";
      case "company" -> "合同归属";
      case "status" -> "状态";
      case "regular_date" -> "转正日期";
      case "leave_date" -> "离职日期";
      case "entry_date" -> "入职日期";
      case "headcount" -> "人数 / 编制";
      case "employee_type" -> "用工类型";
      case "verification" -> "认证状态";
      default -> field;
    };
  }

  String auditValue(String key, Object value) {
    if (value == null) return "未填写";
    String type =
        switch (key) {
          case "org_id", "main_org_id", "parent_id" -> "orgs";
          case "job_id" -> "jobs";
          case "grade_id" -> "grades";
          case "owner_employee_id", "manager_employee_id", "supervisor_id" -> "emps";
          default -> null;
        };
    if (type != null) {
      String business = code(type, value);
      return business.isBlank() ? Db.text(value) : business;
    }
    if (key.equals("verification")) return "VERIFIED".equals(value) ? "已认证" : "未认证";
    if (key.equals("employee_type")) return EntitySchema.to(EntitySchema.EMP_TYPE, value);
    if (value instanceof Map<?, ?> || value instanceof List<?>) return db.json(value);
    return Db.text(value);
  }

  Long ref(String type, Object code, boolean required) {
    String c = Db.text(code);
    if (c.isBlank()) {
      if (required) throw ApiException.bad("请选择有效的关联记录：" + type);
      return null;
    }
    var s = EntitySchema.get(type);
    var r =
        db.one(
            "SELECT id FROM " + s.table() + " WHERE " + s.code() + "=? AND deleted_at IS NULL", c);
    if (r == null) throw ApiException.bad("关联记录不存在或已归档：" + c);
    return Db.num(r.get("id"));
  }

  String code(String type, Object id) {
    if (id == null) return "";
    var s = EntitySchema.get(type);
    var r = db.one("SELECT " + s.code() + " value FROM " + s.table() + " WHERE id=?", id);
    return r == null ? "" : Db.str(r, "value");
  }

  String employeeName(Object id) {
    if (id == null) return "";
    var r = db.one("SELECT name FROM employee WHERE id=?", id);
    return r == null ? "" : Db.str(r, "name");
  }

  static String stringDate(Object v) {
    return v == null ? "" : v.toString().replace('T', ' ');
  }

  Map<String, Object> view(String type, Map<String, Object> raw) {
    var s = EntitySchema.get(type);
    var v = db.object(raw.get("extra"));
    SENSITIVE.forEach(v::remove);
    READONLY.forEach(v::remove);
    v.put("id", Db.str(raw, s.code()));
    v.put("dbId", raw.get("id"));
    v.put("version", raw.get("version"));
    v.put("stableId", type.toUpperCase() + "_" + raw.get("id"));
    s.fields()
        .forEach(
            (field, col) ->
                v.put(
                    field,
                    raw.get(col) == null
                        ? ""
                        : raw.get(col) instanceof java.sql.Date
                            ? stringDate(raw.get(col))
                            : raw.get(col)));
    v.put("deleted", raw.get("deleted_at") != null);
    v.put("deletedAt", stringDate(raw.get("deleted_at")));
    switch (type) {
      case "orgs" -> {
        v.put("sortOrder", raw.get("sort_order"));
        v.put("parent", code("orgs", raw.get("parent_id")));
        v.put("managerId", code("emps", raw.get("manager_employee_id")));
        v.put(
            "manager",
            raw.get("manager_employee_id") == null
                ? Db.str(v, "manager")
                : employeeName(raw.get("manager_employee_id")));
        v.put("status", "ACTIVE".equals(raw.get("status")) ? "启用" : "停用");
        v.putIfAbsent(
            "orgType",
            raw.get("parent_id") == null
                ? "公司"
                : code("orgs", raw.get("parent_id")).equals("ORG_ROOT") ? "部门" : "组");
      }
      case "jobs" -> {
        v.put("dept", code("orgs", raw.get("org_id")));
        v.put("status", "ACTIVE".equals(raw.get("status")) ? "启用" : "停用");
        v.putIfAbsent("sequence", "技术 T");
      }
      case "grades" -> {
        v.put("code", raw.get("code"));
        v.put("status", "ACTIVE".equals(raw.get("status")) ? "启用" : "停用");
        v.putIfAbsent("scope", "全部部门");
        v.putIfAbsent("sequence", "技术 T");
      }
      case "emps" -> {
        v.put("employeeNo", v.get("id"));
        v.put("dept", code("orgs", raw.get("org_id")));
        v.put("directOrgId", v.get("dept"));
        v.put("mainDept", code("orgs", raw.get("main_org_id")));
        v.put("mainDeptId", v.get("mainDept"));
        v.put("secondaryDept", code("orgs", raw.get("secondary_org_id")));
        v.put("job", code("jobs", raw.get("job_id")));
        v.put("grade", code("grades", raw.get("grade_id")));
        v.put("supervisorId", code("emps", raw.get("supervisor_id")));
        v.put("supervisor", v.get("supervisorId"));
        v.put("supervisorName", employeeName(raw.get("supervisor_id")));
        v.put("graduated", v.get("graduation"));
        v.put(
            "status",
            raw.get("deleted_at") == null
                ? EntitySchema.to(EntitySchema.EMP_STATUS, raw.get("status"))
                : "已离职");
        v.put("previousStatus", EntitySchema.to(EntitySchema.EMP_STATUS, raw.get("status")));
        v.put("workType", EntitySchema.to(EntitySchema.EMP_TYPE, raw.get("employee_type")));
        v.put("verification", "VERIFIED".equals(raw.get("verification")) ? "已认证" : "未认证");
        v.put(
            "workHistory",
            db.jdbc.queryForList(
                "SELECT id,company,start_date start,end_date end,leave_reason reason FROM"
                    + " employee_work_history WHERE employee_id=? ORDER BY sort_no,id",
                raw.get("id")));
        v.put("timeline", timeline(Db.num(raw.get("id"))));
        v.put("audit", List.of());
        v.put("files", fileViews("emps", Db.num(raw.get("id"))));
        var sensitive =
            db.one("SELECT employee_id FROM employee_sensitive WHERE employee_id=?", raw.get("id"));
        if (sensitive != null) for (String k : SENSITIVE) v.put(k, "••••••");
      }
      case "reqs" -> {
        v.put("dept", code("orgs", raw.get("org_id")));
        v.put("job", code("jobs", raw.get("job_id")));
        v.put("status", EntitySchema.to(EntitySchema.REQ_STATUS, raw.get("status")));
        v.put("type", "REPLACEMENT".equals(raw.get("recruit_type")) ? "替补" : "新增");
        for (String role : List.of("owner", "screener", "first", "second")) {
          var people =
              db.jdbc.queryForList(
                  "SELECT e.employee_no,e.name FROM request_participant p JOIN employee e ON"
                      + " e.id=p.employee_id WHERE p.request_id=? AND p.participant_role=? ORDER BY"
                      + " e.id",
                  raw.get("id"),
                  role.toUpperCase());
          v.put(role + "Ids", people.stream().map(p -> p.get("employee_no")).toList());
          v.put(role, people.stream().map(p -> Db.str(p, "name")).collect(Collectors.joining("、")));
        }
      }
      case "candidates" -> {
        var req = db.one("SELECT * FROM recruitment_request WHERE id=?", raw.get("request_id"));
        v.put("req", req == null ? "" : req.get("request_no"));
        v.put("dept", req == null ? "" : code("orgs", req.get("org_id")));
        v.put("job", req == null ? "" : code("jobs", req.get("job_id")));
        v.put("historicalJobName", req == null ? "" : db.object(req.get("extra")).getOrDefault("historicalJobName", ""));
        v.put("stage", req == null ? "待关联需求" : EntitySchema.to(EntitySchema.CAND_STAGE, raw.get("stage")));
        if (Boolean.TRUE.equals(v.get("held"))
            && List.of("HR_SCREEN", "DEPT_SCREEN").contains(raw.get("stage")))
          v.put("stage", "暂缓筛选");
        String screeningRole = "DEPT_SCREEN".equals(raw.get("stage")) ? "SCREENER" : "OWNER";
        var screeners =
            db.jdbc.queryForList(
                "SELECT e.employee_no,e.name FROM request_participant p JOIN employee e ON"
                    + " e.id=p.employee_id WHERE p.request_id=? AND p.participant_role=? ORDER BY"
                    + " e.id",
                raw.get("request_id"),
                screeningRole);
        v.put("screenerIds", screeners.stream().map(p -> p.get("employee_no")).toList());
        v.put(
            "screener",
            screeners.stream().map(p -> Db.str(p, "name")).collect(Collectors.joining("、")));
        v.put("location", v.getOrDefault("workRegion", req == null ? "" : req.get("location")));
        v.put("company", v.getOrDefault("contractCompany", req == null ? "" : req.get("company")));
        if (Db.text(v.get("company")).isBlank() && req != null) v.put("company", req.get("company"));
        v.put("created", stringDate(raw.get("created_at")).substring(0, 10));
        v.put("screeningStep", "DEPT_SCREEN".equals(raw.get("stage")) ? "dept" : "hr");
        v.put("history", candidateHistory(Db.num(raw.get("id"))));
        v.put("interviews", interviews(Db.num(raw.get("id"))));
        v.put("files", fileViews("candidates", Db.num(raw.get("id"))));
        if (req != null) {
          v.putIfAbsent("company", req.get("company"));
          v.putIfAbsent("contractCompany", req.get("company"));
        }
        var entry = db.one("SELECT * FROM onboarding_record WHERE candidate_id=?", raw.get("id"));
        if (entry != null) {
          v.put("onboard", stringDate(entry.get("planned_onboard_date")));
          v.put("employeeId", code("emps", entry.get("employee_id")));
          v.put("entryNotes", Db.str(entry, "remark"));
          if ("ONBOARDING".equals(raw.get("stage")))
            v.put(
                "stage",
                switch (Db.str(entry, "result")) {
                  case "POSTPONED" -> "延期入职";
                  case "NO_SHOW" -> "未到岗";
                  case "DECLINED" -> "放弃入职";
                  case "CANCELLED" -> "取消入职";
                  default -> "待入职";
                });
        }
      }
      case "assets" -> {
        v.put("status", EntitySchema.to(EntitySchema.ASSET_STATUS, raw.get("status")));
        v.put("owner", code("emps", raw.get("owner_employee_id")));
        v.put("ownerId", v.get("owner"));
        v.put("dept", code("orgs", raw.get("org_id")));
        v.put(
            "public",
            Boolean.TRUE.equals(raw.get("public_asset"))
                    || "1".equals(Db.text(raw.get("public_asset")))
                ? "是"
                : "否");
        v.put("history", assetHistory(Db.num(raw.get("id"))));
      }
    }
    if (List.of("emps", "jobs", "reqs", "candidates", "assets").contains(type)) {
      v.put("workRegion", v.getOrDefault("location", ""));
      if (type.equals("emps")) v.put("workplace", raw.getOrDefault("workplace", ""));
      else v.putIfAbsent("workplace", v.getOrDefault("office", ""));
      v.put("contractCompany", v.getOrDefault("company", v.getOrDefault("contractCompany", "")));
    }
    return v;
  }

  public Map<String, Object> settings() {
    Map<String, Object> result = new LinkedHashMap<>();
    for (var pair :
        Map.of(
                "workRegion",
                "WORK_REGION",
                "workplace",
                "WORKPLACE",
                "contractCompany",
                "CONTRACT_COMPANY")
            .entrySet()) {
      var rows =
          db.jdbc.queryForList(
              "SELECT i.id,i.item_code code,i.item_name name,i.status,i.aliases FROM"
                  + " base_dictionary_item i JOIN base_dictionary d ON d.id=i.dictionary_id WHERE"
                  + " d.dict_code=? ORDER BY i.sort_no,i.id",
              pair.getValue());
      for (var r : rows) {
        r.put("status", "ACTIVE".equals(r.get("status")) ? "启用" : "停用");
        if (r.get("aliases") instanceof String x) {
          try {
            r.put("aliases", db.json.readValue(x, List.class));
          } catch (Exception ignored) {
            r.put("aliases", List.of());
          }
        } else r.put("aliases", List.of());
      }
      result.put(pair.getKey(), rows);
    }
    return result;
  }

  List<Map<String, Object>> timeline(long id) {
    var rows =
        db.jdbc.queryForList(
            "SELECT l.*,u.display_name FROM employee_change_log l LEFT JOIN sys_user u ON"
                + " u.id=l.operator_user_id WHERE l.employee_id=? AND l.deleted_at IS NULL ORDER BY"
                + " l.created_at DESC,l.id DESC",
            id);
    return rows.stream()
        .map(
            r -> {
              var m = db.object(r.get("after_json"));
              return Db.map(
                  "id",
                  r.get("id"),
                  "date",
                  m.getOrDefault("date", stringDate(r.get("created_at")).substring(0, 10)),
                  "type",
                  r.get("change_type"),
                  "title",
                  m.getOrDefault("title", r.get("change_type")),
                  "detail",
                  m.getOrDefault("detail", "员工资料更新"),
                  "operator",
                  r.get("display_name"),
                  "editable",
                  true);
            })
        .toList();
  }

  List<Map<String, Object>> candidateHistory(long id) {
    return db.jdbc.queryForList(
        "SELECT l.id,l.created_at date,l.to_stage type,l.reason detail,u.display_name operator FROM"
            + " candidate_stage_log l LEFT JOIN sys_user u ON u.id=l.operator_user_id WHERE"
            + " candidate_id=? ORDER BY l.id DESC",
        id);
  }

  List<Map<String, Object>> assetHistory(long id) {
    return db.jdbc.queryForList(
        "SELECT h.id,h.created_at date,h.action type,h.reason detail,u.display_name operator FROM"
            + " asset_history h LEFT JOIN sys_user u ON u.id=h.operator_user_id WHERE asset_id=?"
            + " ORDER BY h.id DESC",
        id);
  }

  List<Map<String, Object>> fileViews(String type, long id) {
    String table = type.equals("emps") ? "employee_file" : "candidate_file",
        fk = type.equals("emps") ? "employee_id" : "candidate_id";
    return db
        .jdbc
        .queryForList(
            "SELECT id,file_name name,size_bytes size,uploaded_at date"
                + (type.equals("emps") ? ",file_type category" : "")
                + " FROM "
                + table
                + " WHERE "
                + fk
                + "=? AND status='ACTIVE' ORDER BY id",
            id)
        .stream()
        .map(
            f -> {
              f.put("url", "/api/" + type + "/files/" + f.get("id"));
              f.put("previewUrl", "/api/" + type + "/files/" + f.get("id") + "?inline=true");
              return f;
            })
        .toList();
  }

  List<Map<String, Object>> interviews(long candidate) {
    return db
        .jdbc
        .queryForList("SELECT * FROM interview WHERE candidate_id=? ORDER BY round_no", candidate)
        .stream()
        .map(
            i -> {
              var m = db.object(i.get("extra"));
              m.put("id", i.get("id"));
              m.put("dbId", i.get("id"));
              m.put("version", i.get("version"));
              m.put("round", Db.num(i.get("round_no")) == 1 ? "初试" : "复试");
              String start = stringDate(i.get("scheduled_start")),
                  end = stringDate(i.get("scheduled_end"));
              m.put("date", start.substring(0, 10));
              m.put("start", start.substring(11, 16));
              m.put("end", end.substring(11, 16));
              m.put(
                  "status",
                  switch (Db.str(i, "status")) {
                    case "CANCELLED" -> "已取消";
                    case "COMPLETED" -> "已完成";
                    case "NO_SHOW", "RESCHEDULED" -> "待改期";
                    default -> "PENDING".equals(i.get("result")) ? "待评价" : "待面试";
                  });
              m.put(
                  "result",
                  switch (Db.str(i, "result")) {
                    case "PASS" -> "通过";
                    case "FAIL" -> "未通过";
                    case "PENDING" -> "待定";
                    case "CANCELLED" -> "候选人取消";
                    case "NO_SHOW" -> "未到场 / 改期";
                    default -> "";
                  });
              m.put("evaluation", Db.str(i, "evaluation"));
              m.put("cancelReason", Db.str(i, "cancelled_reason"));
              var people =
                  db.jdbc.queryForList(
                      "SELECT e.employee_no,e.name FROM interview_interviewer ii JOIN employee e ON"
                          + " e.id=ii.employee_id WHERE ii.interview_id=? ORDER BY e.id",
                      i.get("id"));
              m.put("interviewerIds", people.stream().map(p -> p.get("employee_no")).toList());
              m.put(
                  "interviewer",
                  people.stream().map(p -> Db.str(p, "name")).collect(Collectors.joining("、")));
              return m;
            })
        .toList();
  }

  @Transactional
  public Map<String, Object> save(Actor a, String type, String code, Map<String, Object> body) {
    return saveInternal(a, type, code, body, false);
  }

  Map<String, Object> saveInternal(
      Actor a, String type, String code, Map<String, Object> body, boolean importing) {
    return saveInternal(a, type, code, body, importing, false, false);
  }

  Map<String, Object> saveInternal(
      Actor a, String type, String code, Map<String, Object> body, boolean importing,
      boolean reinstating) {
    return saveInternal(a, type, code, body, importing, reinstating, false);
  }

  Map<String, Object> saveInternal(
      Actor a, String type, String code, Map<String, Object> body, boolean importing,
      boolean reinstating, boolean leaving) {
    var spec = EntitySchema.get(type);
    boolean managerCandidateEdit = type.equals("candidates") && !a.all()
        && a.can("screening:department") && code != null && !importing;
    if (!managerCandidateEdit) audit.require(a, spec.writePermission());
    if (type.equals("orgs")) lockOrgTree();
    var previous = code == null ? null : raw(a, type, code, true);
    if (managerCandidateEdit) {
      if (!Set.of("HR_SCREEN", "DEPT_SCREEN", "FIRST_INTERVIEW", "SECOND_INTERVIEW")
          .contains(Db.str(previous, "stage")))
        throw new ApiException(403, "当前阶段由 HR 维护候选信息。");
      if (!Set.of("name", "phone", "email", "education", "school", "years", "tags", "notes", "version")
          .containsAll(body.keySet()))
        throw new ApiException(403, "部门主管只能修改候选人基本信息。");
    }
    if (previous != null && previous.get("deleted_at") != null)
      throw ApiException.conflict("记录已删除，不能编辑。");
    if (previous != null && !importing) version(previous, body);
    Map<String, Object> merged = previous == null ? new LinkedHashMap<>() : view(type, previous);
    merged.putAll(normalizePatch(type, body));
    if (type.equals("emps")
        && (body.containsKey("dept") || body.containsKey("directOrgId"))
        && !body.containsKey("mainDept")
        && !body.containsKey("mainDeptId")) {
      merged.remove("mainDept");
      merged.remove("mainDeptId");
    }
    normalize(merged);
    String businessCode = previous == null && type.equals("orgs") ? "" : previous == null ? Db.str(merged, "id") : code;
    if (businessCode.isBlank())
      businessCode =
          (type.equals("orgs") ? "ORG_" : type.substring(0, 1).toUpperCase())
              + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    if (businessCode.length() > 64) throw ApiException.bad("业务编号不得超过 64 个字符。");
    if (previous != null && body.containsKey("id") && !code.equals(Db.str(body, "id")))
      throw ApiException.bad("已创建记录的业务编号不能修改。");
    var values = new LinkedHashMap<String, Object>();
    if (previous == null) values.put(spec.code(), businessCode);
    for (var f : spec.fields().entrySet())
      if (merged.containsKey(f.getKey()))
        values.put(f.getValue(), nullable(merged.get(f.getKey())));
    requireText(merged, "name");
    Map<String, Object> validation = new LinkedHashMap<>(merged);
    if (previous != null) {
      var before = view(type, previous);
      for (String key : List.of("location", "workplace", "company"))
        if (Objects.equals(Db.text(before.get(key)), Db.text(merged.get(key))))
          validation.remove(key);
    }
    validateBasic(type, validation, values, importing);
    Map<String, Object> extra = new LinkedHashMap<>(merged);
    extra.keySet().retainAll(EXTRA_FIELDS);
    SENSITIVE.forEach(extra::remove);
    READONLY.forEach(extra::remove);
    spec.fields().keySet().forEach(extra::remove);
    switch (type) {
      case "orgs" -> {
        Long parent = validateOrganization(merged, previous);
        values.put("parent_id", parent);
        if (previous == null || !Objects.equals(parent, previous.get("parent_id"))) {
          Integer last = db.jdbc.queryForObject(
              "SELECT COALESCE(MAX(sort_order),0) FROM org_department WHERE parent_id <=> ?",
              Integer.class, parent);
          values.put("sort_order", last + 1);
        }
        values.put("manager_employee_id", ref("emps", merged.get("managerId"), false));
        if (body.containsKey("managerId") && !body.containsKey("manager")) extra.remove("manager");
        values.put("status", active(merged.get("status")));
        if (previous != null && "INACTIVE".equals(values.get("status")))
          guardOrgInactive(Db.num(previous.get("id")));
      }
      case "jobs" -> {
        long org = ref("orgs", merged.get("dept"), true);
        scope.check(a, org);
        activeOrg(org);
        values.put("org_id", org);
        values.put("status", active(merged.get("status")));
        values.putIfAbsent("headcount", 0);
        if (previous != null) {
          long job = Db.num(previous.get("id"));
          long count =
              db.jdbc.queryForObject(
                  "SELECT COUNT(*) FROM employee WHERE job_id=? AND status NOT IN ('LEFT') AND"
                      + " deleted_at IS NULL",
                  Long.class,
                  job);
          if (decimal(values.get("headcount")).longValue() < count)
            throw ApiException.conflict("岗位编制不能少于当前在岗人数。");
          if (!Objects.equals(org, Db.num(previous.get("org_id"))) && count > 0)
            throw ApiException.conflict("岗位仍有关联员工，不能直接迁移所属组织。");
          if ("INACTIVE".equals(values.get("status"))
              && (count > 0
                  || db.jdbc.queryForObject(
                          "SELECT COUNT(*) FROM recruitment_request WHERE job_id=? AND status IN"
                              + " ('OPEN','PAUSED') AND deleted_at IS NULL",
                          Integer.class,
                          job)
                      > 0)) throw ApiException.conflict("岗位有关联在岗员工或招聘需求，不能停用。");
        }
      }
      case "grades" -> {
        String gradeCode = Db.str(merged, "code").toUpperCase(Locale.ROOT);
        if (!gradeCode.matches("[MTSP](?:[1-9]|1[0-2])"))
          throw ApiException.bad("职级编码须为 M/T/S/P 加 1–12 级数字。");
        if (previous != null && !gradeCode.equals(previous.get("code")))
          throw ApiException.bad("已创建的职级编码不能修改。");
        int gradeLevel = Integer.parseInt(gradeCode.substring(1));
        if (Db.num(merged.get("level")) != gradeLevel)
          throw ApiException.bad("职级层级须与编码数字一致。");
        String expectedSequence = switch (gradeCode.charAt(0)) {
          case 'M' -> "管理 M";
          case 'T' -> "技术 T";
          case 'S' -> "营销 S";
          default -> "专业 P";
        };
        if (!expectedSequence.equals(Db.str(merged, "sequence")))
          throw ApiException.bad("职务序列须与职级编码字母一致。");
        values.put("code", gradeCode);
        values.put("status", active(merged.get("status")));
        values.putIfAbsent("level_no", 1);
        values.putIfAbsent("min_years", 0);
      }
      case "emps" -> {
        employeeValues(a, merged, values, previous, importing, reinstating, leaving);
      }
      case "reqs" -> {
        requestValues(a, merged, values, previous);
      }
      case "candidates" -> {
        Long request = Db.str(merged, "req").isBlank() ? null : ref("reqs", merged.get("req"), true);
        if (request == null && !a.all()) throw new ApiException(403, "未关联招聘需求的简历仅限 HR 管理员维护。");
        var r = request == null ? null : db.one("SELECT * FROM recruitment_request WHERE id=? FOR UPDATE", request);
        if (r != null) {
          scope.check(a, Db.num(r.get("org_id")));
          if (!"OPEN".equals(r.get("status")) && (previous == null || previous.get("request_id") == null))
            throw ApiException.conflict("仅招聘中的需求可以关联简历。");
        }
        values.put("request_id", request);
        if (previous == null) {
          values.put("stage", "HR_SCREEN");
          extra.remove("stage");
          extra.remove("screeningStep");
        } else {
          if (body.containsKey("stage")
              && !Objects.equals(body.get("stage"), view(type, previous).get("stage")))
            throw ApiException.bad("阶段变更必须通过筛选、面试或入职接口。");
          if (previous.get("request_id") != null && !Objects.equals(request, Db.num(previous.get("request_id"))))
            throw ApiException.bad("候选人的招聘需求不能直接改绑。");
        }
        if (db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM candidate WHERE request_id <=> ? AND phone=? AND deleted_at IS"
                    + " NULL AND id<>?",
                Integer.class,
                request,
                values.get("phone"),
                previous == null ? 0 : previous.get("id"))
            > 0) throw ApiException.conflict("同一招聘需求下此手机号已存在。");
      }
      case "assets" -> {
        assetValues(a, merged, values, previous);
      }
    }
    values.put("extra", db.json(extra));
    long id;
    if (previous == null) id = db.insert(spec.table(), values);
    else {
      id = Db.num(previous.get("id"));
      values.put("version", Db.num(previous.get("version")) + 1);
      db.update(spec.table(), values, id);
    }
    if (type.equals("emps")) {
      saveSensitive(id, body);
      if (body.containsKey("workHistory")) saveWorkHistory(id, body.get("workHistory"));
      Map<String, Object> before = previous == null ? Map.of() : safeSnapshot(previous),
          after = safeSnapshot(db.one("SELECT * FROM employee WHERE id=?", id));
      List<String> changes = new ArrayList<>();
      for (var f :
          Map.of(
                  "org_id",
                  "组织",
                  "job_id",
                  "岗位",
                  "grade_id",
                  "职级",
                  "location",
                  "工作片区",
                  "workplace",
                  "工作所在地",
                  "company",
                  "合同归属",
                  "status",
                  "人员状态",
                  "regular_date",
                  "转正日期",
                  "leave_date",
                  "离职日期")
              .entrySet()) {
        if (!Objects.equals(before.get(f.getKey()), after.get(f.getKey())))
          changes.add(
              f.getValue()
                  + "："
                  + Db.text(before.get(f.getKey()))
                  + " → "
                  + Db.text(after.get(f.getKey())));
      }
      db.jdbc.update(
          "INSERT INTO"
              + " employee_change_log(employee_id,change_type,before_json,after_json,operator_user_id)"
              + " VALUES(?,?,?,?,?)",
          id,
          previous == null ? "入职"
              : "LEFT".equals(after.get("status")) && !"LEFT".equals(before.get("status"))
                  ? "离职"
                  : "LEFT".equals(before.get("status")) && !"LEFT".equals(after.get("status"))
                      ? "复职" : "资料变更",
          db.json(before),
          db.json(
              Db.map(
                  "date", "LEFT".equals(after.get("status"))
                      ? Db.str(merged, "leaveDate") : LocalDate.now(ZoneId.of("Asia/Shanghai")).toString(),
                  "title", previous == null ? "入职"
                      : "LEFT".equals(after.get("status")) && !"LEFT".equals(before.get("status"))
                          ? "离职"
                          : "LEFT".equals(before.get("status")) && !"LEFT".equals(after.get("status"))
                              ? "复职" : "资料变更",
                  "detail",
                  previous == null
                      ? "创建员工档案"
                      : changes.isEmpty()
                          ? "更新员工资料：" + String.join("、", body.keySet())
                          : String.join("；", changes),
                  "snapshot",
                  after)),
          a.id());
    }
    if (type.equals("reqs")) saveParticipants(id, merged);
    if (type.equals("assets")) assetLog(a, id, previous, values, Db.str(body, "reason"));
    if (type.equals("candidates") && previous == null) stageLog(a, id, null, "HR_SCREEN", "简历录入");
    var auditAfter = safeSnapshot(db.one("SELECT * FROM " + spec.table() + " WHERE id=?", id));
    var sensitiveChanged =
        body.keySet().stream()
            .filter(SENSITIVE::contains)
            .filter(k -> !Db.str(body, k).contains("••") && !Db.str(body, k).matches(".*\\*{3,}.*"))
            .toList();
    if (!sensitiveChanged.isEmpty()) auditAfter.put("sensitiveFieldsChanged", sensitiveChanged);
    String auditAction = previous == null ? "CREATE" : "UPDATE";
    if (type.equals("emps") && previous != null) {
      if (!"LEFT".equals(previous.get("status")) && "LEFT".equals(auditAfter.get("status")))
        auditAction = "LEAVE";
      else if ("LEFT".equals(previous.get("status")) && !"LEFT".equals(auditAfter.get("status")))
        auditAction = "REINSTATE";
    }
    audit.record(
        a,
        auditAction,
        type,
        id,
        previous == null ? null : safeSnapshot(previous),
        auditAfter);
    return view(type, db.one("SELECT * FROM " + spec.table() + " WHERE id=?", id));
  }

  static void version(Map<String, Object> row, Map<String, Object> body) {
    if (!body.containsKey("version")) throw new ApiException(428, "请提供记录版本号。");
    if (Db.num(body.get("version")) != Db.num(row.get("version")))
      throw ApiException.conflict("记录已被其他人修改，请刷新后再试。");
  }

  Map<String, Object> safeSnapshot(Map<String, Object> row) {
    var safe = new LinkedHashMap<String, Object>();
    for (var field : row.entrySet())
      if (!Set.of("extra", "phone", "email").contains(field.getKey())
          && !field.getKey().contains("cipher")) safe.put(field.getKey(), field.getValue());
    for (var field : db.object(row.get("extra")).entrySet())
      if (EXTRA_FIELDS.contains(field.getKey())
          && !SENSITIVE.contains(field.getKey())
          && !field.getKey().equals("photo")
          && !safe.containsKey(field.getKey())) safe.put(field.getKey(), field.getValue());
    return canonicalAuditSnapshot(safe);
  }

  Map<String, Object> canonicalAuditSnapshot(Map<String, Object> source) {
    var snapshot = new LinkedHashMap<>(source);
    for (var alias :
        Map.of(
                "workRegion", "location",
                "contractCompany", "company",
                "notes", "remark",
                "workType", "employee_type",
                "actualRegular", "regular_date")
            .entrySet()) {
      if (!snapshot.containsKey(alias.getKey())) continue;
      if (!snapshot.containsKey(alias.getValue()))
        snapshot.put(alias.getValue(), snapshot.get(alias.getKey()));
      snapshot.remove(alias.getKey());
    }
    if (snapshot.get("verification") != null)
      snapshot.put(
          "verification",
          Set.of("已认证", "已核验", "VERIFIED").contains(Db.str(snapshot, "verification"))
              ? "VERIFIED"
              : "UNVERIFIED");
    if (snapshot.get("employee_type") != null)
      snapshot.put(
          "employee_type",
          EntitySchema.from(EntitySchema.EMP_TYPE, snapshot.get("employee_type"), "FULL_TIME"));
    return snapshot;
  }

  static Object nullable(Object value) {
    return value == null || value instanceof String s && s.isBlank() ? null : value;
  }

  static String active(Object value) {
    String s = Db.text(value);
    if (s.isBlank() || List.of("启用", "ACTIVE").contains(s)) return "ACTIVE";
    if (List.of("停用", "INACTIVE").contains(s)) return "INACTIVE";
    throw ApiException.bad("启停状态无效。");
  }

  static void normalize(Map<String, Object> m) {
    if (m.containsKey("workRegion")) m.put("location", m.get("workRegion"));
    if (m.containsKey("contractCompany")) m.put("company", m.get("contractCompany"));
    if (m.containsKey("directOrgId") && !m.containsKey("dept")) m.put("dept", m.get("directOrgId"));
  }

  static Map<String, Object> normalizePatch(String type, Map<String, Object> input) {
    var patch = new LinkedHashMap<>(input);
    syncPatchAlias(patch, input, "location", "workRegion");
    syncPatchAlias(patch, input, "company", "contractCompany");
    if (type.equals("emps")) {
      syncPatchAlias(patch, input, "dept", "directOrgId");
      syncPatchAlias(patch, input, "mainDeptId", "mainDept");
      syncPatchAlias(patch, input, "supervisorId", "supervisor");
      syncPatchAlias(patch, input, "graduation", "graduated");
    }
    return patch;
  }

  static void syncPatchAlias(
      Map<String, Object> patch, Map<String, Object> input, String canonical, String alias) {
    if (!input.containsKey(canonical) && !input.containsKey(alias)) return;
    Object value = input.containsKey(canonical) ? input.get(canonical) : input.get(alias);
    patch.put(canonical, value);
    patch.put(alias, value);
  }

  static void requireText(Map<String, Object> m, String key) {
    if (Db.str(m, key).isBlank()) throw ApiException.bad("必填字段未填写：" + key);
  }

  static BigDecimal decimal(Object value) {
    if (value == null || Db.text(value).isBlank()) return BigDecimal.ZERO;
    try {
      return new BigDecimal(value.toString());
    } catch (Exception e) {
      throw ApiException.bad("数值格式不正确。");
    }
  }

  void validateBasic(String type, Map<String, Object> m, Map<String, Object> values, boolean importing) {
    String phone = Db.str(m, "phone");
    if (!phone.isBlank() && !phone.matches("1\\d{10}")) throw ApiException.bad("手机号须为 11 位有效号码。");
    String email = Db.str(m, "email");
    if (!email.isBlank() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
      throw ApiException.bad("邮箱格式不正确。");
    for (var e : values.entrySet()) {
      if (e.getValue() == null) continue;
      if (e.getKey().endsWith("_date")
          || Set.of(
                  "entry_date",
                  "leave_date",
                  "contract_start",
                  "contract_end",
                  "first_contract_start",
                  "first_contract_end",
                  "deadline")
              .contains(e.getKey())) {
        try {
          LocalDate.parse(Db.text(e.getValue()));
        } catch (Exception x) {
          throw ApiException.bad("日期格式须为 YYYY-MM-DD：" + e.getKey());
        }
      }
    }
    for (String f : List.of("headcount", "count", "level")) {
      if (m.containsKey(f)) {
        var n = decimal(m.get(f));
        if (n.scale() > 0 && n.stripTrailingZeros().scale() > 0
            || n.signum() < 0
            || !f.equals("headcount") && n.signum() == 0) throw ApiException.bad("人数与层级须为有效整数。");
      }
    }
    for (String f : List.of("cost", "years", "min", "salaryMin", "salaryMax"))
      if (m.containsKey(f) && decimal(m.get(f)).signum() < 0)
        throw ApiException.bad("数值不能为负数：" + f);
    if (decimal(m.get("salaryMin")).compareTo(decimal(m.get("salaryMax"))) > 0)
      throw ApiException.bad("薪资下限不得高于上限。");
    if (importing && type.equals("emps")) return;
    for (var pair :
        Map.of("location", "WORK_REGION", "workplace", "WORKPLACE", "company", "CONTRACT_COMPANY")
            .entrySet()) {
      String value = Db.str(m, pair.getKey());
      if (value.isBlank()) continue;
      if (db.jdbc.queryForObject(
              "SELECT COUNT(*) FROM base_dictionary_item i JOIN base_dictionary d ON"
                  + " d.id=i.dictionary_id WHERE d.dict_code=? AND i.item_name=? AND"
                  + " i.status='ACTIVE'",
              Integer.class,
              pair.getValue(),
              value)
          == 0) throw ApiException.bad("基础信息不存在或已停用：" + value);
    }
  }

  void activeOrg(long org) {
    if (!"ACTIVE".equals(db.one("SELECT status FROM org_department WHERE id=?", org).get("status")))
      throw ApiException.bad("所属组织已停用。");
  }

  void lockOrgTree() {
    // Serialize organization mutations, including sibling-name checks and archive decisions.
    db.jdbc.queryForList(
        "SELECT id FROM org_department WHERE parent_id IS NULL ORDER BY id FOR UPDATE");
  }

  Long validateOrganization(Map<String, Object> input, Map<String, Object> previous) {
    boolean root = previous != null && previous.get("parent_id") == null;
    Long parent = ref("orgs", input.get("parent"), !root);
    String type = Db.str(input, "orgType");
    if (root) {
      if (parent != null
          || !type.isBlank() && !type.equals("公司")
          || !active(input.get("status")).equals("ACTIVE"))
        throw ApiException.bad("根组织须保持公司类型、无上级组织且启用。");
    } else {
      activeOrg(parent);
      if (!type.isBlank() && !Set.of("部门", "组").contains(type))
        throw ApiException.bad("组织类型须为部门或组。");
      if (previous != null
          && (parent == Db.num(previous.get("id"))
              || scope.within(parent, Db.num(previous.get("id")))))
        throw ApiException.bad("上级组织不能是自己或下级组织。");
    }
    String phone = Db.str(input, "managerPhone");
    if (!phone.isBlank() && !phone.matches("[+\\d][\\d\\s()\\-]{2,24}"))
      throw ApiException.bad("请填写有效的负责人电话。");
    if (!db.jdbc
        .queryForList(
            "SELECT id FROM org_department WHERE parent_id <=> ? AND name=?"
                + " AND id<>? AND deleted_at IS NULL FOR UPDATE",
            parent,
            Db.str(input, "name"),
            previous == null ? 0L : previous.get("id"))
        .isEmpty()) throw ApiException.conflict("该上级组织下已存在同名组织。");
    return parent;
  }

  void guardOrgArchive(Map<String, Object> org) {
    long id = Db.num(org.get("id"));
    if (org.get("parent_id") == null) throw ApiException.bad("根组织不能归档。");
    if (db.jdbc.queryForObject(
            "SELECT COUNT(*) FROM org_department WHERE parent_id=? AND deleted_at IS NULL",
            Integer.class,
            id)
        > 0) throw ApiException.conflict("该组织下还有子组织，请先调整子组织。");
    for (String table :
        List.of("employee", "job_position", "recruitment_request", "asset", "sys_user")) {
      String predicate = table.equals("employee") ? "(org_id=? OR main_org_id=? OR secondary_org_id=?)" : "org_id=?";
      Object[] args = table.equals("employee") ? new Object[] {id, id, id} : new Object[] {id};
      if (db.jdbc.queryForObject(
              "SELECT COUNT(*) FROM " + table + " WHERE " + predicate, Integer.class, args)
          > 0) throw ApiException.conflict("该组织已关联人员、岗位或业务数据，请先调整关联关系。");
    }
    if (db.jdbc.queryForObject(
            "SELECT COUNT(*) FROM grade WHERE JSON_UNQUOTE(JSON_EXTRACT(extra,'$.scope')) IN (?,?)",
            Integer.class,
            org.get("code"),
            org.get("name"))
        > 0) throw ApiException.conflict("该组织已关联职级适用范围，不能归档。");
  }

  void guardOrgInactive(long id) {
    for (String t : List.of("org_department", "job_position", "employee", "recruitment_request")) {
      String col = t.equals("org_department") ? "parent_id" : "org_id";
      String condition =
          t.equals("employee")
              ? " AND status<>'LEFT'"
              : t.equals("recruitment_request")
                  ? " AND status IN ('OPEN','PAUSED')"
                  : " AND status='ACTIVE'";
      if (db.jdbc.queryForObject(
              "SELECT COUNT(*) FROM "
                  + t
                  + " WHERE "
                  + col
                  + "=? AND deleted_at IS NULL"
                  + condition,
              Integer.class,
              id)
          > 0) throw ApiException.conflict("组织仍有启用下级、员工、岗位或招聘需求，不能停用/归档。");
    }
  }

  @Transactional
  public Map<String, Object> moveOrg(Actor actor, String code, String direction) {
    audit.require(actor, "orgs:write");
    if (!Set.of("up", "down").contains(direction)) throw ApiException.bad("排序方向无效。");
    lockOrgTree();
    var current = raw(actor, "orgs", code, true);
    if (current.get("parent_id") == null) throw ApiException.bad("根组织不能排序。");
    var siblings = db.jdbc.queryForList(
        "SELECT id,sort_order FROM org_department WHERE parent_id=? AND deleted_at IS NULL"
            + " ORDER BY sort_order,id FOR UPDATE",
        current.get("parent_id"));
    int index = -1;
    for (int i = 0; i < siblings.size(); i++)
      if (Db.num(siblings.get(i).get("id")) == Db.num(current.get("id"))) index = i;
    int neighbor = index + (direction.equals("up") ? -1 : 1);
    if (index < 0 || neighbor < 0 || neighbor >= siblings.size())
      throw ApiException.conflict("已经是同级组织的最前或最后一项。");
    var other = siblings.get(neighbor);
    db.jdbc.update("UPDATE org_department SET sort_order=? WHERE id=?",
        other.get("sort_order"), current.get("id"));
    db.jdbc.update("UPDATE org_department SET sort_order=? WHERE id=?",
        current.get("sort_order"), other.get("id"));
    audit.record(actor, "REORDER", "orgs", Db.num(current.get("id")), null,
        Db.map("direction", direction));
    return view("orgs", db.one("SELECT * FROM org_department WHERE id=?", current.get("id")));
  }

  void employeeValues(
      Actor a, Map<String, Object> m, Map<String, Object> values, Map<String, Object> previous,
      boolean importing, boolean reinstating, boolean leaving) {
    long org = ref("orgs", m.get("dept"), true);
    scope.check(a, org);
    activeOrg(org);
    values.put("org_id", org);
    long top = scope.top(org);
    String main = Db.str(m, "mainDeptId");
    if (main.isBlank()) main = Db.str(m, "mainDept");
    if (!main.isBlank() && !main.equals(code("orgs", top)))
      throw ApiException.bad("主部门必须为直属组织的顶层部门。");
    values.put("main_org_id", top);
    Long secondary = ref("orgs", m.get("secondaryDept"), false);
    Long previousSecondary =
        previous == null || previous.get("secondary_org_id") == null
            ? null
            : Db.num(previous.get("secondary_org_id"));
    if (!Objects.equals(secondary, previousSecondary))
      throw ApiException.bad("兼任部门录入已停用，已有记录仅供查看。");
    if (secondary != null) {
      if (secondary == org) throw ApiException.bad("兼任部门不能与主部门相同。");
      scope.check(a, secondary);
      activeOrg(secondary);
    }
    values.put("secondary_org_id", secondary);
    Long job = ref("jobs", m.get("job"), false);
    if (job != null) {
      var j = db.one("SELECT * FROM job_position WHERE id=?", job);
      if (Db.num(j.get("org_id")) != org || !"ACTIVE".equals(j.get("status")))
        throw ApiException.bad("员工岗位必须属于直属组织且处于启用状态。");
    }
    values.put("job_id", job);
    values.put("grade_id", ref("grades", m.get("grade"), false));
    Long supervisor = ref("emps", m.get("supervisorId"), false);
    validateSupervisor(previous == null ? null : Db.num(previous.get("id")), supervisor);
    values.put("supervisor_id", supervisor);
    String status = EntitySchema.from(EntitySchema.EMP_STATUS, m.get("status"), "PROBATION");
    if ("LEFT".equals(status) && (previous == null || !"LEFT".equals(previous.get("status")))
        && !importing && !leaving)
      throw ApiException.conflict("请通过办理离职操作更改员工状态。");
    if ("LEFT".equals(status) && Db.str(m, "leaveDate").isBlank())
      throw ApiException.bad("离职日期不能为空。");
    if (status.equals("LEFT")
        && previous != null
        && db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM asset WHERE owner_employee_id=? AND deleted_at IS NULL",
                Integer.class,
                previous.get("id"))
            > 0) throw ApiException.conflict("员工仍有领用资产，请先归还或转移。");
    if (previous != null && "LEFT".equals(previous.get("status")) && !status.equals("LEFT")
        && !reinstating)
      throw ApiException.conflict("请通过复职操作恢复在岗状态。");
    values.put("status", status);
    values.put(
        "employee_type", EntitySchema.from(EntitySchema.EMP_TYPE, m.get("workType"), "FULL_TIME"));
    values.put(
        "verification",
        Set.of("已认证", "已核验", "VERIFIED").contains(Db.str(m, "verification"))
            ? "VERIFIED"
            : "UNVERIFIED");
    validateEmployeeDates(m);
    if (!Db.str(m, "entry").isBlank()
        && !Db.str(m, "leaveDate").isBlank()
        && LocalDate.parse(Db.str(m, "leaveDate")).isBefore(LocalDate.parse(Db.str(m, "entry"))))
      throw ApiException.bad("离职日期不能早于入职日期。");
    if (!Db.str(m, "contractStart").isBlank()
        && !Db.str(m, "contractEnd").isBlank()
        && LocalDate.parse(Db.str(m, "contractEnd"))
            .isBefore(LocalDate.parse(Db.str(m, "contractStart"))))
      throw ApiException.bad("合同结束日期不能早于开始日期。");
  }

  static void validateEmployeeDates(Map<String, Object> employee) {
    LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
    String regular = Db.str(employee, "actualRegular"), entry = Db.str(employee, "entry");
    if (!regular.isBlank()) {
      LocalDate date = LocalDate.parse(regular);
      if (date.isAfter(today)) throw ApiException.bad("实际转正日期不能晚于今天。");
      if (!entry.isBlank() && date.isBefore(LocalDate.parse(entry)))
        throw ApiException.bad("实际转正日期不能早于入职日期。");
    }
    String start = Db.str(employee, "firstContractStart"),
        end = Db.str(employee, "firstContractEnd");
    if (!start.isBlank() && !end.isBlank() && LocalDate.parse(end).isBefore(LocalDate.parse(start)))
      throw ApiException.bad("首次合同到期日不能早于起始日。");
  }

  void validateSupervisor(Long employee, Long supervisor) {
    Set<Long> seen = new HashSet<>();
    if (employee != null) seen.add(employee);
    Long current = supervisor;
    while (current != null) {
      if (!seen.add(current)) throw ApiException.bad("直属主管不能形成循环关系。");
      var person = db.one("SELECT supervisor_id FROM employee WHERE id=? FOR UPDATE", current);
      current =
          person == null || person.get("supervisor_id") == null
              ? null
              : Db.num(person.get("supervisor_id"));
    }
  }

  void requestValues(
      Actor a, Map<String, Object> m, Map<String, Object> values, Map<String, Object> previous) {
    if (previous != null && previous.get("job_id") == null)
      throw ApiException.conflict("历史招聘需求的岗位已删除，不能编辑。");
    long org = ref("orgs", m.get("dept"), true);
    var previousJob =
        previous == null
            ? null
            : db.one("SELECT code FROM job_position WHERE id=?", previous.get("job_id"));
    long job =
        previousJob != null && Db.text(previousJob.get("code")).equals(Db.text(m.get("job")))
            ? Db.num(previous.get("job_id"))
            : ref("jobs", m.get("job"), true);
    scope.check(a, org);
    activeOrg(org);
    var j = db.one("SELECT * FROM job_position WHERE id=? FOR UPDATE", job);
    if (!scope.within(Db.num(j.get("org_id")), org) || !"ACTIVE".equals(j.get("status")))
      throw ApiException.bad("招聘岗位必须属于需求部门或其下级组织且处于启用状态。");
    values.put("org_id", org);
    values.put("job_id", job);
    requireText(m, "location");
    requireText(m, "company");
    values.putIfAbsent("headcount", 1);
    values.put("recruit_type", "替补".equals(Db.str(m, "type")) ? "REPLACEMENT" : "NEW");
    values.put("status", EntitySchema.from(EntitySchema.REQ_STATUS, m.get("status"), "OPEN"));
    if (previous != null
        && (org != Db.num(previous.get("org_id")) || job != Db.num(previous.get("job_id")))
        && db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM candidate WHERE request_id=?",
                Integer.class,
                previous.get("id"))
            > 0) throw ApiException.conflict("需求已有候选人，不能改变部门或岗位关联。");
    for (String role : List.of("owner", "screener", "first", "second"))
      for (long employee : personIds(m, role, true)) participantScope(a, employee);
    var owner = personIds(m, "owner", true);
    values.put("owner_employee_id", owner.get(0));
    for (var pair :
        Map.of(
                "screener",
                "screener_employee_id",
                "first",
                "first_interviewer_id",
                "second",
                "second_interviewer_id")
            .entrySet()) {
      var ids = personIds(m, pair.getKey(), true);
      values.put(pair.getValue(), ids.get(0));
    }
    long arrived =
        previous == null
            ? 0
            : db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM candidate WHERE request_id=? AND stage='HIRED'",
                Long.class,
                previous.get("id"));
    if (decimal(values.get("headcount")).longValue() < arrived)
      throw ApiException.conflict("需求人数不能少于已入职人数。");
    long occupied =
        db.jdbc.queryForObject(
            "SELECT COUNT(*) FROM employee WHERE job_id=? AND status<>'LEFT' AND deleted_at IS"
                + " NULL",
            Long.class,
            job);
    long pending =
        db.jdbc.queryForObject(
            "SELECT COALESCE(SUM(GREATEST(r.headcount-(SELECT COUNT(*) FROM candidate c WHERE"
                + " c.request_id=r.id AND c.stage='HIRED'),0)),0) FROM recruitment_request r WHERE"
                + " r.job_id=? AND r.status IN ('OPEN','PAUSED') AND r.deleted_at IS NULL AND"
                + " r.id<>?",
            Long.class,
            job,
            previous == null ? 0 : previous.get("id"));
    long leaving =
        "REPLACEMENT".equals(values.get("recruit_type"))
            ? db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM employee WHERE job_id=? AND status='PENDING_LEAVE' AND"
                    + " deleted_at IS NULL",
                Long.class,
                job)
            : 0;
    long proposed =
        Set.of("OPEN", "PAUSED").contains(values.get("status"))
            ? Math.max(0, decimal(values.get("headcount")).longValue() - arrived)
            : 0;
    if (occupied + pending + proposed - leaving > Db.num(j.get("headcount")))
      throw ApiException.conflict("需求人数超出岗位可用编制，请调整岗位编制或需求人数。");
  }

  List<Long> personIds(Map<String, Object> m, String key, boolean required) {
    Object raw = m.get(key + "Ids");
    List<?> values = raw instanceof List<?> l ? l : List.of();
    if (values.isEmpty() && required) throw ApiException.bad("请选择负责人：" + key);
    List<Long> out = new ArrayList<>();
    for (Object c : values) {
      Long id = ref("emps", c, true);
      var e = db.one("SELECT status FROM employee WHERE id=?", id);
      if (List.of("LEFT", "PENDING_LEAVE").contains(e.get("status")))
        throw ApiException.bad("负责人必须为有效在岗员工。");
      if (!out.contains(id)) out.add(id);
    }
    return out;
  }

  void saveParticipants(long id, Map<String, Object> m) {
    db.jdbc.update("DELETE FROM request_participant WHERE request_id=?", id);
    for (String key : List.of("owner", "screener", "first", "second"))
      for (long person : personIds(m, key, key.equals("owner")))
        db.jdbc.update(
            "INSERT INTO request_participant(request_id,employee_id,participant_role)"
                + " VALUES(?,?,?)",
            id,
            person,
            key.toUpperCase());
  }

  void participantScope(Actor actor, long employee) {
    if (actor.all()) return;
    var person =
        db.one(
            "SELECT e.org_id,o.name main_name FROM employee e LEFT JOIN org_department o ON"
                + " o.id=e.main_org_id WHERE e.id=?",
            employee);
    if (scope.orgs(actor).contains(Db.num(person.get("org_id")))
        || Db.str(person, "main_name").matches(".*(人事|人力|行政).*")) return;
    Long managerOrg = actor.orgId();
    if (managerOrg != null
        && db.jdbc.queryForObject(
                "WITH RECURSIVE chain AS (SELECT id,parent_id,manager_employee_id FROM"
                    + " org_department WHERE id=? UNION ALL SELECT"
                    + " p.id,p.parent_id,p.manager_employee_id FROM org_department p JOIN chain c"
                    + " ON p.id=c.parent_id) SELECT COUNT(*) FROM chain WHERE"
                    + " manager_employee_id=?",
                Integer.class,
                managerOrg,
                employee)
            > 0) return;
    audit.denied(actor, "REQUEST_PARTICIPANT", employee);
    throw new ApiException(403, "负责人或面试官不在可选人员范围内。");
  }

  void assetValues(
      Actor a, Map<String, Object> m, Map<String, Object> values, Map<String, Object> previous) {
    boolean pub = "是".equals(Db.str(m, "public"));
    Long owner = ref("emps", m.get("owner"), false);
    String status = EntitySchema.from(EntitySchema.ASSET_STATUS, m.get("status"), "IDLE");
    if (pub && owner != null) throw ApiException.bad("公共资产不能指定个人使用人。");
    if (status.equals("IN_USE") && !pub && owner == null) throw ApiException.bad("使用中的个人资产须指定使用人。");
    if (Set.of("IDLE", "SCRAPPED").contains(status) && owner != null)
      throw ApiException.bad("闲置、报废资产须先归还。");
    Long org = ref("orgs", m.get("dept"), false);
    if (owner != null) {
      var person = db.one("SELECT * FROM employee WHERE id=? FOR UPDATE", owner);
      if (Set.of("LEFT", "PENDING_LEAVE").contains(person.get("status")))
        throw ApiException.bad("待离职或已离职员工不能领用资产。");
      org = Db.num(person.get("org_id"));
    }
    if (org != null) scope.check(a, org);
    values.put("org_id", org);
    values.put("owner_employee_id", owner);
    values.put("public_asset", pub);
    values.put("status", status);
    if (previous != null && "SCRAPPED".equals(previous.get("status")) && !status.equals("SCRAPPED"))
      throw ApiException.conflict("已报废资产不可恢复使用。");
  }

  void assetLog(
      Actor a, long id, Map<String, Object> old, Map<String, Object> values, String reason) {
    Object before = old == null ? null : old.get("owner_employee_id"),
        after = values.get("owner_employee_id");
    String from = old == null ? "IDLE" : Db.str(old, "status"), to = Db.str(values, "status");
    String action;
    if ("SCRAPPED".equals(to)) action = "SCRAP";
    else if ("REPAIRING".equals(to) && !to.equals(from)) action = "REPAIR_START";
    else if ("REPAIRING".equals(from) && !to.equals(from)) action = "REPAIR_END";
    else if (before == null && after != null) action = "ASSIGN";
    else if (before != null && after == null) action = "RETURN";
    else if (!Objects.equals(before, after)) action = "TRANSFER";
    else action = "LOCATION_CHANGE";
    db.jdbc.update(
        "INSERT INTO"
            + " asset_history(asset_id,action,from_owner_employee_id,to_owner_employee_id,from_status,to_status,reason,operator_user_id)"
            + " VALUES(?,?,?,?,?,?,?,?)",
        id,
        action,
        before,
        after,
        from,
        to,
        reason.isBlank() ? (old == null ? "资产登记" : "资产资料维护") : reason,
        a.id());
  }

  void saveSensitive(long employee, Map<String, Object> body) {
    var row = db.one("SELECT * FROM employee_sensitive WHERE employee_id=?", employee);
    Map<String, Object> data = sensitiveData(row);
    boolean changed = false;
    for (String k : SENSITIVE) {
      if (!body.containsKey(k)) continue;
      String value = Db.str(body, k);
      if (value.contains("••") || value.matches(".*\\*{3,}.*")) continue;
      if (k.equals("householdType") && value.length() > 64)
        throw ApiException.bad("户籍类型不得超过 64 个字符。");
      data.put(k, value);
      changed = true;
    }
    if (!changed) return;
    if (data.containsKey("idNo") && !data.containsKey("identityNumber"))
      data.put("identityNumber", data.get("idNo"));
    if (data.containsKey("bankAccount") && !data.containsKey("bankNumber"))
      data.put("bankNumber", data.get("bankAccount"));
    db.jdbc.update(
        "INSERT INTO"
            + " employee_sensitive(employee_id,id_no_cipher,bank_account_cipher,social_account_cipher,housing_fund_no_cipher,native_place_cipher,household_location_cipher,address_cipher,emergency_contact_cipher,household_type,extra_cipher)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE"
            + " id_no_cipher=VALUES(id_no_cipher),bank_account_cipher=VALUES(bank_account_cipher),social_account_cipher=VALUES(social_account_cipher),housing_fund_no_cipher=VALUES(housing_fund_no_cipher),native_place_cipher=VALUES(native_place_cipher),household_location_cipher=VALUES(household_location_cipher),address_cipher=VALUES(address_cipher),emergency_contact_cipher=VALUES(emergency_contact_cipher),household_type=VALUES(household_type),extra_cipher=VALUES(extra_cipher)",
        employee,
        crypto.encrypt(Db.str(data, "identityNumber")),
        crypto.encrypt(Db.str(data, "bankNumber")),
        crypto.encrypt(Db.str(data, "socialAccount")),
        crypto.encrypt(Db.str(data, "fundAccount")),
        crypto.encrypt(Db.str(data, "nativePlace")),
        crypto.encrypt(Db.str(data, "identityAddress")),
        crypto.encrypt(Db.str(data, "address")),
        crypto.encrypt(
            db.json(
                Db.map(
                    "name", Db.str(data, "emergency"), "phone", Db.str(data, "emergencyPhone")))),
        nullable(data.get("householdType")),
        crypto.encrypt(db.json(data)));
  }

  Map<String, Object> sensitiveData(Map<String, Object> row) {
    Map<String, Object> data = new LinkedHashMap<>();
    if (row == null) return data;
    if (row.get("extra_cipher") != null)
      data.putAll(db.object(crypto.decrypt((byte[]) row.get("extra_cipher"))));
    if (row.get("household_type") != null) data.put("householdType", Db.str(row, "household_type"));
    return data;
  }

  public Map<String, Object> sensitive(Actor a, String employee) {
    audit.require(a, "emps:sensitive");
    var r = raw(a, "emps", employee, false);
    var s = db.one("SELECT * FROM employee_sensitive WHERE employee_id=?", r.get("id"));
    audit.record(a, "SENSITIVE_READ", "emps", Db.num(r.get("id")), null, null);
    return sensitiveData(s);
  }

  void saveWorkHistory(long id, Object input) {
    var rows = validatedWorkHistory(input);
    db.jdbc.update("DELETE FROM employee_work_history WHERE employee_id=?", id);
    int order = 0;
    for (var m : rows) {
      db.jdbc.update(
          "INSERT INTO"
              + " employee_work_history(employee_id,company,start_date,end_date,leave_reason,sort_no)"
              + " VALUES(?,?,?,?,?,?)",
          id,
          m.get("company"),
          m.get("start"),
          nullable(m.get("end")),
          m.get("reason"),
          order++);
    }
  }

  List<Map<String, Object>> validatedWorkHistory(Object input) {
    if (!(input instanceof List<?> rows)) throw ApiException.bad("工作经历须为数组。");
    if (rows.size() > 50) throw ApiException.bad("工作经历最多 50 段。");
    List<Map<String, Object>> result = new ArrayList<>();
    LocalDate today = LocalDate.now(ZoneId.of("Asia/Shanghai"));
    for (Object item : rows) {
      var m = db.object(item);
      String start = Db.str(m, "start"), end = Db.str(m, "end");
      String company = Db.str(m, "company"),
          reason = Db.text(m.getOrDefault("reason", m.get("leaveReason")));
      if (company.isBlank() && start.isBlank() && end.isBlank() && reason.isBlank()) continue;
      if (company.isBlank() || start.isBlank()) throw ApiException.bad("工作经历请填写公司和就职时间。");
      if (!start.isBlank() && start.length() == 7) start += "-01";
      if (!end.isBlank() && end.length() == 7) end += "-01";
      try {
        LocalDate from = LocalDate.parse(start), to = end.isBlank() ? null : LocalDate.parse(end);
        if (from.isAfter(today) || to != null && (to.isBefore(from) || to.isAfter(today)))
          throw ApiException.bad("请核对工作经历的起止日期。");
      } catch (DateTimeException e) {
        throw ApiException.bad("工作经历日期格式须为 YYYY-MM-DD。");
      }
      result.add(Db.map("company", company, "start", start, "end", end, "reason", reason));
    }
    return result;
  }

  void stageLog(Actor a, long candidate, String from, String to, String reason) {
    db.jdbc.update(
        "INSERT INTO candidate_stage_log(candidate_id,from_stage,to_stage,reason,operator_user_id)"
            + " VALUES(?,?,?,?,?)",
        candidate,
        from,
        to,
        reason,
        a.id());
  }

  @Transactional
  public Map<String, Object> archive(Actor a, String type, String code, boolean restore) {
    var s = EntitySchema.get(type);
    audit.require(a, s.writePermission());
    if (type.equals("emps"))
      throw ApiException.bad("员工档案请使用办理离职、复职或彻底删除操作。");
    if (type.equals("orgs")) lockOrgTree();
    var r = raw(a, type, code, true);
    long id = Db.num(r.get("id"));
    if (!restore) {
      if (type.equals("orgs")) {
        guardOrgArchive(r);
      }
      if (type.equals("jobs")
          && (db.jdbc.queryForObject(
                      "SELECT COUNT(*) FROM employee WHERE job_id=? AND status<>'LEFT' AND"
                          + " deleted_at IS NULL",
                      Integer.class,
                      id)
                  > 0
              || db.jdbc.queryForObject(
                      "SELECT COUNT(*) FROM recruitment_request WHERE job_id=? AND deleted_at IS"
                          + " NULL",
                      Integer.class,
                      id)
                  > 0)) throw ApiException.conflict("岗位仍有关联员工或招聘需求，不能归档。");
      if (type.equals("grades")
          && db.jdbc.queryForObject(
                  "SELECT COUNT(*) FROM employee WHERE grade_id=? AND status<>'LEFT' AND deleted_at"
                      + " IS NULL",
                  Integer.class,
                  id)
              > 0) throw ApiException.conflict("职级仍有关联员工，不能归档。");
      if (type.equals("reqs") && !"CLOSED".equals(r.get("status")))
        throw ApiException.conflict("请先关闭招聘需求，再删除需求记录。");
      if (type.equals("assets") && r.get("owner_employee_id") != null)
        throw ApiException.conflict("领用资产须先归还，才能归档。");
      if (type.equals("candidates")
          && !Set.of("HR_SCREEN", "DEPT_SCREEN", "REJECTED", "CANCELLED").contains(r.get("stage")))
        throw ApiException.conflict("候选人仍在面试或入职流程，不能归档。");
    }
    db.jdbc.update(
        "UPDATE "
            + s.table()
            + " SET deleted_at="
            + (restore ? "NULL" : "UTC_TIMESTAMP()")
            + ",version=version+1 WHERE id=?",
        id);
    audit.record(a, restore ? "RESTORE" : "ARCHIVE", type, id, null, null);
    return view(type, db.one("SELECT * FROM " + s.table() + " WHERE id=?", id));
  }

  @Transactional
  public Map<String, Object> permanentlyDeleteEmployee(Actor actor, String code) {
    audit.require(actor, "emps:write");
    var row = raw(actor, "emps", code, true);
    if (!"LEFT".equals(row.get("status"))) throw ApiException.conflict("请先办理离职");
    long id = Db.num(row.get("id"));
    Map<String, String> relations = new LinkedHashMap<>();
    relations.put("sys_user", "employee_id");
    relations.put("org_department", "manager_employee_id");
    relations.put("employee", "supervisor_id");
    relations.put("request_participant", "employee_id");
    relations.put("interview_interviewer", "employee_id");
    relations.put("onboarding_record", "employee_id");
    relations.put("asset", "owner_employee_id");
    for (var relation : relations.entrySet())
      if (db.jdbc.queryForObject(
          "SELECT COUNT(*) FROM " + relation.getKey() + " WHERE " + relation.getValue() + "=?",
          Integer.class, id) > 0)
        throw ApiException.conflict("员工仍关联账号、组织、下属或业务记录，请先解除关联。");
    for (String column : List.of("owner_employee_id", "screener_employee_id",
        "first_interviewer_id", "second_interviewer_id"))
      if (db.jdbc.queryForObject(
          "SELECT COUNT(*) FROM recruitment_request WHERE " + column + "=?", Integer.class, id) > 0)
        throw ApiException.conflict("员工仍关联招聘需求，请先解除关联。");
    if (db.jdbc.queryForObject(
        "SELECT COUNT(*) FROM asset_history WHERE from_owner_employee_id=? OR to_owner_employee_id=?",
        Integer.class, id, id) > 0)
      throw ApiException.conflict("员工仍关联资产履历，不能彻底删除。");
    if (db.jdbc.queryForObject(
        "SELECT COUNT(*) FROM employee_file WHERE employee_id=? AND status='ACTIVE'",
        Integer.class, id) > 0)
      throw ApiException.conflict("请先删除员工档案材料。");
    db.jdbc.update("DELETE FROM audit_log WHERE resource_type='emps' AND resource_id=?", id);
    db.jdbc.update("DELETE FROM employee_file WHERE employee_id=?", id);
    db.jdbc.update("DELETE FROM employee_change_log WHERE employee_id=?", id);
    db.jdbc.update("DELETE FROM employee_work_history WHERE employee_id=?", id);
    db.jdbc.update("DELETE FROM employee_sensitive WHERE employee_id=?", id);
    db.jdbc.update("DELETE FROM employee WHERE id=?", id);
    audit.record(actor, "PERMANENT_DELETE", "emps", id, null, null);
    return Db.map("deleted", true, "id", code);
  }
}

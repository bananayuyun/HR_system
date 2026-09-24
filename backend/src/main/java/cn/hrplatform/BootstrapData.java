package cn.hrplatform;

import com.fasterxml.jackson.core.type.TypeReference;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Business dictionaries exist in every profile. Fictional people are dev-only. */
@Component
public class BootstrapData implements ApplicationRunner {
  final Db db;
  final HrService hr;
  final Auth auth;
  final boolean demo;
  final Environment environment;

  BootstrapData(
      Db db,
      HrService hr,
      Auth auth,
      Environment environment,
      @Value("${hr.seed-demo}") boolean demo) {
    this.db = db;
    this.hr = hr;
    this.auth = auth;
    this.demo = demo;
    this.environment = environment;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) throws Exception {
    boolean production = Arrays.asList(environment.getActiveProfiles()).contains("prod");
    if (demo
        && !production
        && db.jdbc.queryForObject("SELECT COUNT(*) FROM employee", Integer.class) == 0) seed();
    if (db.one("SELECT setting_key FROM sys_setting WHERE setting_key='sequences'") == null)
      db.jdbc.update(
          "INSERT INTO sys_setting(setting_key,value_json) VALUES('sequences',?)",
          db.json(List.of("管理 M", "技术 T", "营销 S", "专业 P")));
  }

  List<Map<String, Object>> rows(Map<String, Object> source, String key) {
    return (List<Map<String, Object>>) source.getOrDefault(key, List.of());
  }

  Map<String, Object> extras(Map<String, Object> source) {
    var m = new LinkedHashMap<String, Object>();
    for (String k : HrService.EXTRA_FIELDS)
      if (source.containsKey(k)
          && !(source.get(k) instanceof Map)
          && !(source.get(k) instanceof List)) m.put(k, source.get(k));
    return m;
  }

  void seed() throws Exception {
    Map<String, Object> source;
    try (InputStream stream = getClass().getResourceAsStream("/dev/prototype-seed.json")) {
      source = db.json.readValue(stream, new TypeReference<LinkedHashMap<String, Object>>() {});
    }
    long seedUser =
        db.insert(
            "sys_user",
            Db.map(
                "username", "__demo_seed__",
                "display_name", "演示数据初始化",
                "password_hash", auth.hashPassword(UUID.randomUUID().toString()),
                "status", "DISABLED"));
    Actor admin =
        new Actor(
            seedUser, "__demo_seed__", "演示数据初始化", List.of("HR_ADMIN"), List.of(), null, "", "ALL");
    // Company grades are created by V4; demo employees use their nearest current grade.
    for (var j : rows(source, "jobs")) {
      var jobExtra = extras(j);
      jobExtra.computeIfPresent("sequence", (key, value) -> switch (Db.text(value)) {
        case "管理序列 M" -> "管理 M";
        case "技术序列 T" -> "技术 T";
        case "销售序列 S" -> "营销 S";
        default -> value;
      });
      db.insert(
          "job_position",
          Db.map(
              "code",
              j.get("id"),
              "name",
              j.get("name"),
              "org_id",
              hr.ref("orgs", j.get("dept"), true),
              "location",
              j.getOrDefault("workRegion", "上海"),
              "headcount",
              j.get("headcount"),
              "duties",
              j.get("duties"),
              "requirements",
              j.get("requirements"),
              "extra",
              db.json(jobExtra)));
    }
    for (var e : rows(source, "emps")) {
      Map<String, Object> values = new LinkedHashMap<>();
      for (var field : EntitySchema.get("emps").fields().entrySet())
        if (e.containsKey(field.getKey()))
          values.put(field.getValue(), HrService.nullable(e.get(field.getKey())));
      values.put("employee_no", e.get("id"));
      values.put("org_id", hr.ref("orgs", e.get("dept"), true));
      values.put("main_org_id", hr.dataScope().top(Db.num(values.get("org_id"))));
      values.put("job_id", hr.ref("jobs", e.get("job"), false));
      values.put("grade_id", hr.ref("grades", companyGrade(Db.text(e.get("grade"))), false));
      values.put("status", EntitySchema.from(EntitySchema.EMP_STATUS, e.get("status"), "ACTIVE"));
      values.put(
          "employee_type",
          EntitySchema.from(EntitySchema.EMP_TYPE, e.get("workType"), "FULL_TIME"));
      values.put("extra", db.json(extras(e)));
      long id = db.insert("employee", values);
      hr.saveSensitive(id, e);
      if (e.containsKey("workHistory")) hr.saveWorkHistory(id, e.get("workHistory"));
      for (var event : rows(e, "timeline"))
        db.insert(
            "employee_change_log",
            Db.map(
                "employee_id",
                id,
                "change_type",
                event.getOrDefault("type", "入职"),
                "after_json",
                db.json(
                    Db.map(
                        "date",
                        event.get("date"),
                        "title",
                        event.get("title"),
                        "detail",
                        event.get("detail"),
                        "manual",
                        false)),
                "operator_user_id",
                admin.id()));
    }
    for (var o : rows(source, "orgs")) {
      Long manager = hr.ref("emps", o.get("managerId"), false);
      db.jdbc.update(
          "UPDATE org_department SET manager_employee_id=?,location=?,extra=? WHERE code=?",
          manager,
          o.get("location"),
          db.json(extras(o)),
          o.get("id"));
    }
    for (var r : rows(source, "reqs")) {
      var owner = ids(r, "ownerIds");
      var screener = ids(r, "screenerIds");
      var first = ids(r, "firstIds");
      var second = ids(r, "secondIds");
      long id =
          db.insert(
              "recruitment_request",
              Db.map(
                  "request_no",
                  r.get("id"),
                  "name",
                  r.get("name"),
                  "job_id",
                  hr.ref("jobs", r.get("job"), true),
                  "org_id",
                  hr.ref("orgs", r.get("dept"), true),
                  "location",
                  r.get("location"),
                  "company",
                  r.get("company"),
                  "headcount",
                  r.get("count"),
                  "salary_min",
                  r.get("salaryMin"),
                  "salary_max",
                  r.get("salaryMax"),
                  "recruit_type",
                  "替补".equals(Db.str(r, "type")) ? "REPLACEMENT" : "NEW",
                  "deadline",
                  r.get("deadline"),
                  "owner_employee_id",
                  owner.get(0),
                  "screener_employee_id",
                  screener.isEmpty() ? null : screener.get(0),
                  "first_interviewer_id",
                  first.isEmpty() ? null : first.get(0),
                  "second_interviewer_id",
                  second.isEmpty() ? null : second.get(0),
                  "extra",
                  db.json(extras(r))));
      for (var role :
          Map.of("OWNER", owner, "SCREENER", screener, "FIRST", first, "SECOND", second).entrySet())
        for (long person : role.getValue())
          db.jdbc.update(
              "INSERT IGNORE INTO request_participant(request_id,employee_id,participant_role)"
                  + " VALUES(?,?,?)",
              id,
              person,
              role.getKey());
    }
    for (var c : rows(source, "candidates")) {
      String stage = EntitySchema.from(EntitySchema.CAND_STAGE, c.get("stage"), "HR_SCREEN");
      if ("待 HR 筛选".equals(Db.str(c, "stage")) && "dept".equals(Db.str(c, "screeningStep")))
        stage = "DEPT_SCREEN";
      var extra = extras(c);
      extra.put("held", "暂缓筛选".equals(Db.str(c, "stage")));
      long id =
          db.insert(
              "candidate",
              Db.map(
                  "code",
                  c.get("id"),
                  "request_id",
                  hr.ref("reqs", c.get("req"), true),
                  "name",
                  c.get("name"),
                  "phone",
                  c.get("phone"),
                  "email",
                  c.get("email"),
                  "source",
                  c.get("source"),
                  "stage",
                  stage,
                  "education",
                  c.get("education"),
                  "years",
                  c.get("years"),
                  "created_at",
                  Db.str(c, "created") + " 09:00:00",
                  "extra",
                  db.json(extra)));
      for (var h : rows(c, "history")) hr.stageLog(admin, id, null, stage, Db.str(h, "detail"));
      for (var i : rows(c, "interviews")) {
        int round = "初试".equals(Db.str(i, "round")) ? 1 : 2;
        String state =
            switch (Db.str(i, "status")) {
              case "已完成" -> "COMPLETED";
              case "已取消" -> "CANCELLED";
              case "待改期" -> "RESCHEDULED";
              default -> "SCHEDULED";
            };
        String result =
            switch (Db.str(i, "result")) {
              case "通过" -> "PASS";
              case "未通过" -> "FAIL";
              case "待定" -> "PENDING";
              case "候选人取消" -> "CANCELLED";
              case "未到场 / 改期" -> "NO_SHOW";
              default -> null;
            };
        long interview =
            db.insert(
                "interview",
                Db.map(
                    "candidate_id",
                    id,
                    "round_no",
                    round,
                    "scheduled_start",
                    Db.str(i, "date") + " " + Db.str(i, "start") + ":00",
                    "scheduled_end",
                    Db.str(i, "date") + " " + Db.str(i, "end") + ":00",
                    "status",
                    state,
                    "result",
                    result,
                    "evaluation",
                    i.get("evaluation"),
                    "created_by",
                    admin.id(),
                    "extra",
                    db.json(
                        Db.map(
                            "method",
                            i.get("method"),
                            "place",
                            i.get("place"),
                            "votes",
                            i.getOrDefault("votes", List.of()),
                            "evaluator",
                            i.get("evaluator"),
                            "evaluatedAt",
                            i.get("evaluatedAt")))));
        var interviewers = ids(i, "interviewerIds");
        if (interviewers.isEmpty())
          interviewers =
              db.jdbc.queryForList(
                  "SELECT p.employee_id FROM request_participant p JOIN recruitment_request r ON"
                      + " r.id=p.request_id WHERE r.request_no=? AND p.participant_role=?",
                  Long.class,
                  c.get("req"),
                  round == 1 ? "FIRST" : "SECOND");
        for (long person : interviewers)
          db.jdbc.update(
              "INSERT IGNORE INTO interview_interviewer(interview_id,employee_id) VALUES(?,?)",
              interview,
              person);
      }
      if (Set.of("ONBOARDING", "HIRED").contains(stage)) {
        String result =
            stage.equals("HIRED")
                ? "HIRED"
                : switch (Db.str(c, "stage")) {
                  case "延期入职" -> "POSTPONED";
                  case "未到岗" -> "NO_SHOW";
                  case "放弃入职" -> "DECLINED";
                  case "取消入职" -> "CANCELLED";
                  default -> "PENDING_ONBOARD";
                };
        db.insert(
            "onboarding_record",
            Db.map(
                "candidate_id",
                id,
                "employee_id",
                hr.ref("emps", c.get("employeeId"), false),
                "planned_onboard_date",
                HrService.nullable(c.get("onboard")),
                "actual_onboard_date",
                stage.equals("HIRED") ? HrService.nullable(c.get("onboard")) : null,
                "result",
                result,
                "created_by",
                admin.id()));
      }
    }
    for (var asset : rows(source, "assets")) {
      Long owner = hr.ref("emps", asset.get("owner"), false);
      Long org =
          owner == null
              ? hr.ref("orgs", asset.get("dept"), false)
              : Long.valueOf(
                  Db.num(db.one("SELECT org_id FROM employee WHERE id=?", owner).get("org_id")));
      long id =
          db.insert(
              "asset",
              Db.map(
                  "asset_no",
                  asset.get("id"),
                  "name",
                  asset.get("name"),
                  "category",
                  asset.get("category"),
                  "model",
                  asset.get("model"),
                  "location",
                  asset.get("location"),
                  "office",
                  asset.get("office"),
                  "owner_employee_id",
                  owner,
                  "org_id",
                  org,
                  "public_asset",
                  "是".equals(Db.str(asset, "public")),
                  "status",
                  EntitySchema.from(EntitySchema.ASSET_STATUS, asset.get("status"), "IDLE"),
                  "purchased_date",
                  asset.get("purchased"),
                  "value",
                  asset.get("cost"),
                  "extra",
                  db.json(extras(asset))));
      db.insert(
          "asset_history",
          Db.map(
              "asset_id",
              id,
              "action",
              "LOCATION_CHANGE",
              "reason",
              "演示资产初始化",
              "operator_user_id",
              admin.id()));
    }
    db.jdbc.update(
        "INSERT INTO sys_setting(setting_key,value_json) VALUES('sequences',?) ON DUPLICATE KEY"
            + " UPDATE value_json=VALUES(value_json)",
        db.json(List.of("管理 M", "技术 T", "营销 S", "专业 P")));
    deleteJobsAbsentFromRoster(source);
    db.jdbc.update(
        "INSERT INTO sys_setting(setting_key,value_json)"
            + " VALUES('demo_initialized',JSON_OBJECT('complete',true))");
  }

  void deleteJobsAbsentFromRoster(Map<String, Object> source) throws Exception {
    Set<String> rosterPositions;
    try (InputStream stream = getClass().getResourceAsStream("/dev/roster-positions.txt")) {
      if (stream == null) throw new IllegalStateException("Roster position reference is missing.");
      rosterPositions =
          new String(stream.readAllBytes(), StandardCharsets.UTF_8)
              .lines()
              .map(String::trim)
              .filter(name -> !name.isEmpty())
              .collect(java.util.stream.Collectors.toSet());
    }
    for (var job : rows(source, "jobs"))
      if (!rosterPositions.contains(Db.text(job.get("name")))
          || "J1".equals(Db.text(job.get("id")))) {
        var row =
            db.one(
                "SELECT id FROM job_position WHERE code=? AND name=?",
                job.get("id"),
                job.get("name"));
        if (row == null) continue;
        long id = Db.num(row.get("id"));
        db.jdbc.update(
            "UPDATE employee SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),"
                + " '$.historicalJobName',?,'$.historicalJobCode',?),job_id=NULL,version=version+1"
                + " WHERE job_id=?",
            job.get("name"),
            job.get("id"),
            id);
        db.jdbc.update(
            "UPDATE recruitment_request SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),"
                + " '$.historicalJobName',?,'$.historicalJobCode',?),job_id=NULL,"
                + " status=CASE WHEN status IN ('OPEN','PAUSED') THEN 'CLOSED' ELSE status END,"
                + " version=version+1 WHERE job_id=?",
            job.get("name"),
            job.get("id"),
            id);
        db.jdbc.update("DELETE FROM job_position WHERE id=?", id);
      }
  }

  static String companyGrade(String legacy) {
    return switch (legacy) {
      case "M1" -> "M4";
      case "M2", "M3" -> "M8";
      case "M4" -> "M9";
      case "S1" -> "S2";
      case "S2" -> "S4";
      case "T1", "T2-6" -> "T2";
      case "T2" -> "T4";
      case "T3" -> "T6";
      case "T4", "T5", "T6", "T7" -> "T8";
      default -> legacy;
    };
  }

  List<Long> ids(Map<String, Object> map, String key) {
    List<Long> out = new ArrayList<>();
    if (map.get(key) instanceof List<?> list)
      for (Object v : list) {
        String code = v instanceof Map<?, ?> m ? Db.text(m.get("id")) : Db.text(v);
        var person = db.one("SELECT id FROM employee WHERE employee_no=?", code);
        if (person == null) continue;
        Long id = Db.num(person.get("id"));
        if (!out.contains(id)) out.add(id);
      }
    return out;
  }
}

package cn.hrplatform;

import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkflowService {
  private final HrService hr;
  private final Db db;
  private final Audit audit;
  private final Scope scope;

  WorkflowService(HrService hr) {
    this.hr = hr;
    this.db = hr.database();
    this.audit = hr.auditor();
    this.scope = hr.dataScope();
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public Map<String, Object> action(
      Actor a, String type, String code, String action, Map<String, Object> body) {
    return switch (type) {
      case "candidates" -> candidate(a, code, action, body);
      case "assets" -> asset(a, code, action, body);
      case "emps" -> employee(a, code, action, body);
      default -> throw new ApiException(404, "操作不存在。");
    };
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public Map<String, Object> batchScreening(Actor actor, Map<String, Object> body) {
    var ids = batchIds(body.get("ids"));
    // Lock in a stable order, then preflight every record before the first business write.
    for (String id : ids.stream().sorted().toList()) {
      var candidate = hr.raw(actor, "candidates", id, true);
      screeningNext(actor, candidate, body);
    }
    List<Map<String, Object>> items = new ArrayList<>();
    for (String id : ids) items.add(candidate(actor, id, "screening", body));
    return Db.map("items", items, "count", items.size());
  }

  static List<String> batchIds(Object input) {
    if (!(input instanceof List<?> values) || values.isEmpty() || values.size() > 200)
      throw ApiException.bad("批量筛选须选择 1 至 200 位候选人。");
    var ids = new LinkedHashSet<String>();
    for (Object value : values) {
      if (!(value instanceof String id) || id.isBlank() || id.length() > 64)
        throw ApiException.bad("候选人编号无效。");
      if (!ids.add(id.trim())) throw ApiException.bad("候选人编号不能重复。");
    }
    return new ArrayList<>(ids);
  }

  String screeningNext(Actor actor, Map<String, Object> candidate, Map<String, Object> body) {
    if (candidate.get("deleted_at") != null) throw ApiException.conflict("候选人已归档。");
    String stage = Db.str(candidate, "stage");
    if (!Set.of("HR_SCREEN", "DEPT_SCREEN").contains(stage))
      throw ApiException.conflict("候选人不在筛选阶段。");
    audit.require(actor, stage.equals("HR_SCREEN") ? "screening:hr" : "screening:department");
    ensureOpenRequest(candidate);
    if (!actor.all()
        && db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM request_participant p JOIN sys_user u ON"
                    + " u.employee_id=p.employee_id WHERE p.request_id=? AND"
                    + " p.participant_role='SCREENER' AND u.id=?",
                Integer.class,
                candidate.get("request_id"),
                actor.id())
            == 0) {
      audit.denied(actor, "screening", Db.num(candidate.get("id")));
      throw new ApiException(403, "当前账号不是此需求的部门筛选负责人。");
    }
    return switch (Db.str(body, "result")) {
      case "通过", "进入下一阶段" -> stage.equals("HR_SCREEN") ? "DEPT_SCREEN" : "FIRST_INTERVIEW";
      case "退回", "退回 HR", "退回HR" -> {
        if (!stage.equals("DEPT_SCREEN")) throw ApiException.bad("仅部门筛选可以退回 HR。");
        yield "HR_SCREEN";
      }
      case "暂缓", "暂缓筛选" -> stage;
      case "未通过", "不通过" -> "REJECTED";
      case "候选人取消" -> "CANCELLED";
      default -> throw ApiException.bad("筛选结果无效。");
    };
  }

  Map<String, Object> candidate(Actor a, String code, String action, Map<String, Object> body) {
    if (action.equals("interview-check")) return interviewCheck(a, code, body);
    var c = hr.raw(a, "candidates", code, true);
    if (c.get("deleted_at") != null) throw ApiException.conflict("候选人已归档。");
    long id = Db.num(c.get("id"));
    String stage = Db.str(c, "stage");
    switch (action) {
      case "screening" -> {
        String next = screeningNext(a, c, body);
        String result = Db.str(body, "result"), reason = Db.str(body, "reason");
        if (reason.isBlank()) reason = Db.str(body, "notes");
        var extra = db.object(c.get("extra"));
        extra.put("held", result.contains("暂缓"));
        extra.put("returned", result.startsWith("退回"));
        db.jdbc.update(
            "UPDATE candidate SET stage=?,reject_reason=?,extra=?,version=version+1 WHERE id=?",
            next,
            Set.of("REJECTED", "CANCELLED").contains(next) ? reason : null,
            db.json(extra),
            id);
        hr.stageLog(a, id, stage, next, result + "；" + reason);
      }
      case "schedule" -> {
        audit.require(a, "interviews:write");
        if (!Set.of("FIRST_INTERVIEW", "SECOND_INTERVIEW").contains(stage))
          throw ApiException.conflict("仅面试阶段可以安排面试。");
        ensureOpenRequest(c);
        int round = stage.equals("FIRST_INTERVIEW") ? 1 : 2;
        String date = Db.str(body, "date"),
            start = Db.str(body, "start"),
            end = Db.str(body, "end");
        LocalDateTime from = parseTime(date, start), to = parseTime(date, end);
        if (!to.isAfter(from)) throw ApiException.bad("面试结束时间必须晚于开始时间。");
        if (from.isBefore(LocalDateTime.now(ZoneId.of("Asia/Shanghai"))))
          throw ApiException.bad("不能安排过去的面试。");
        var existing =
            db.one(
                "SELECT * FROM interview WHERE candidate_id=? AND round_no=? FOR UPDATE",
                id,
                round);
        if (existing != null && "COMPLETED".equals(existing.get("status")))
          throw ApiException.conflict("已完成的面试不能重新安排。");
        var people = body.get("interviewerIds") instanceof List<?> l ? l : List.of();
        if (people.isEmpty()) throw ApiException.bad("至少选择一名面试官。");
        List<Long> ids =
            people.stream()
                .map(person -> hr.ref("emps", person, true))
                .distinct()
                .sorted()
                .toList();
        for (long person : ids) {
          var p = db.one("SELECT org_id,status FROM employee WHERE id=? FOR UPDATE", person);
          if (Set.of("LEFT", "PENDING_LEAVE").contains(p.get("status")))
            throw ApiException.bad("面试官必须在岗。");
          hr.participantScope(a, person);
          interviewerEligible(c, person);
          var overlap =
              db.jdbc.queryForList(
                  "SELECT i.id FROM interview i JOIN interview_interviewer ii ON"
                      + " ii.interview_id=i.id WHERE ii.employee_id=? AND i.status='SCHEDULED' AND"
                      + " i.id<>? AND i.scheduled_start<? AND i.scheduled_end>? FOR UPDATE",
                  person,
                  existing == null ? 0 : existing.get("id"),
                  to,
                  from);
          if (!overlap.isEmpty()) throw ApiException.conflict("面试官在此时段已有其他面试。");
        }
        var extra =
            existing == null
                ? new LinkedHashMap<String, Object>()
                : db.object(existing.get("extra"));
        if (existing != null) {
          var before =
              hr.interviews(id).stream()
                  .filter(value -> Db.num(value.get("id")) == Db.num(existing.get("id")))
                  .findFirst()
                  .orElseThrow();
          recordReschedule(extra, a, before);
        }
        extra.put("method", Db.str(body, "method"));
        extra.put("place", Db.str(body, "place"));
        long interview;
        if (existing == null)
          interview =
              db.insert(
                  "interview",
                  Db.map(
                      "candidate_id",
                      id,
                      "round_no",
                      round,
                      "scheduled_start",
                      from,
                      "scheduled_end",
                      to,
                      "status",
                      "SCHEDULED",
                      "created_by",
                      a.id(),
                      "extra",
                      db.json(extra)));
        else {
          interview = Db.num(existing.get("id"));
          db.jdbc.update(
              "UPDATE interview SET"
                  + " scheduled_start=?,scheduled_end=?,status='SCHEDULED',result=NULL,cancelled_reason=NULL,extra=?,version=version+1"
                  + " WHERE id=?",
              from,
              to,
              db.json(extra),
              interview);
          db.jdbc.update("DELETE FROM interview_interviewer WHERE interview_id=?", interview);
        }
        for (long person : ids)
          db.jdbc.update(
              "INSERT INTO interview_interviewer(interview_id,employee_id) VALUES(?,?)",
              interview,
              person);
        db.jdbc.update("UPDATE candidate SET version=version+1 WHERE id=?", id);
        hr.stageLog(
            a,
            id,
            stage,
            stage,
            (existing == null ? "安排" : "调整") + "面试：" + date + " " + start + "–" + end);
      }
      case "interview-result" -> {
        audit.require(a, "interviews:write");
        if (!Set.of("FIRST_INTERVIEW", "SECOND_INTERVIEW").contains(stage))
          throw ApiException.conflict("候选人不在面试阶段。");
        ensureOpenRequest(c);
        var interview = currentInterview(c, body);
        if (!a.all()
            && db.jdbc.queryForObject(
                    "SELECT COUNT(*) FROM interview_interviewer i JOIN sys_user u ON"
                        + " u.employee_id=i.employee_id WHERE i.interview_id=? AND u.id=?",
                    Integer.class,
                    interview.get("id"),
                    a.id())
                == 0) {
          audit.denied(a, "interview-result", Db.num(interview.get("id")));
          throw new ApiException(403, "当前账号不是这场面试的面试官。");
        }
        String status = Db.str(interview, "status");
        if (!status.equals("SCHEDULED")) throw ApiException.conflict("此面试尚未有效安排或已处理。");
        LocalDateTime scheduled =
            LocalDateTime.parse(
                HrService.stringDate(interview.get("scheduled_start")).replace(' ', 'T'));
        if (scheduled.toLocalDate().isAfter(LocalDate.now(ZoneId.of("Asia/Shanghai"))))
          throw ApiException.bad("面试日期尚未到达，不能提前录入结果。");
        String result = Db.str(body, "result"), evaluation = Db.str(body, "evaluation");
        if (Set.of("通过", "未通过", "不通过").contains(result) && evaluation.isBlank())
          throw ApiException.bad("通过或未通过时须填写面试评价。");
        String dbResult =
            switch (result) {
              case "通过" -> "PASS";
              case "未通过", "不通过" -> "FAIL";
              case "待定" -> "PENDING";
              case "候选人取消" -> "CANCELLED";
              case "未到场 / 改期", "未到场", "改期" -> "NO_SHOW";
              default -> throw ApiException.bad("面试结果无效。");
            };
        String next =
            switch (dbResult) {
              case "PASS" -> stage.equals("FIRST_INTERVIEW") ? "SECOND_INTERVIEW" : "ONBOARDING";
              case "FAIL" -> "REJECTED";
              case "CANCELLED" -> "CANCELLED";
              default -> stage;
            };
        String nextStatus =
            dbResult.equals("PENDING")
                ? "SCHEDULED"
                : dbResult.equals("NO_SHOW") ? "RESCHEDULED" : "COMPLETED";
        var extra = db.object(interview.get("extra"));
        extra.put("evaluator", a.displayName());
        extra.put("evaluatedAt", LocalDateTime.now().toString());
        recordVote(extra, a, result, evaluation);
        db.jdbc.update(
            "UPDATE interview SET"
                + " status=?,result=?,evaluation=?,extra=?,scores_json=?,version=version+1 WHERE"
                + " id=?",
            nextStatus,
            dbResult,
            evaluation,
            db.json(extra),
            body.containsKey("scores") ? db.json(body.get("scores")) : null,
            interview.get("id"));
        db.jdbc.update("UPDATE candidate SET stage=?,version=version+1 WHERE id=?", next, id);
        if (next.equals("ONBOARDING"))
          db.jdbc.update(
              "INSERT INTO onboarding_record(candidate_id,created_by) VALUES(?,?) ON DUPLICATE KEY"
                  + " UPDATE candidate_id=VALUES(candidate_id)",
              id,
              a.id());
        hr.stageLog(a, id, stage, next, result + "；" + evaluation);
      }
      case "interview-cancel" -> {
        audit.require(a, "interviews:write");
        var i = currentInterview(c, body);
        if (!Set.of("SCHEDULED", "RESCHEDULED").contains(i.get("status")))
          throw ApiException.conflict("面试当前不可取消。");
        String reason = Db.str(body, "reason");
        if (reason.isBlank()) throw ApiException.bad("请填写取消原因。");
        db.jdbc.update(
            "UPDATE interview SET status='CANCELLED',cancelled_reason=?,version=version+1 WHERE"
                + " id=?",
            reason,
            i.get("id"));
        hr.stageLog(a, id, stage, stage, "取消面试：" + reason);
      }
      case "onboarding" -> {
        onboarding(a, c, body);
      }
      default -> throw new ApiException(404, "候选人操作不存在。");
    }
    audit.record(
        a,
        action,
        "candidates",
        id,
        null,
        Db.map("action", Db.str(body, "action"), "result", Db.str(body, "result")));
    return hr.view("candidates", db.one("SELECT * FROM candidate WHERE id=?", id));
  }

  static LocalDateTime parseTime(String date, String time) {
    try {
      return LocalDateTime.of(LocalDate.parse(date), LocalTime.parse(time));
    } catch (Exception e) {
      throw ApiException.bad("请提供正确的日期与时间。");
    }
  }

  static void recordVote(Map<String, Object> extra, Actor actor, String result, String evaluation) {
    List<Map<String, Object>> votes = new ArrayList<>();
    if (extra.get("votes") instanceof List<?> existing)
      for (Object value : existing)
        if (value instanceof Map<?, ?> vote)
          votes.add(new LinkedHashMap<>((Map<String, Object>) vote));
    var updated =
        Db.map(
            "operatorId",
            actor.id(),
            "operator",
            actor.displayName(),
            "result",
            result,
            "evaluation",
            evaluation.trim(),
            "date",
            LocalDateTime.now(ZoneId.of("Asia/Shanghai")).toString());
    for (int i = 0; i < votes.size(); i++) {
      var vote = votes.get(i);
      boolean own =
          vote.get("operatorId") != null
              ? Db.num(vote.get("operatorId")) == actor.id()
              : Db.str(vote, "operator").equals(actor.displayName());
      if (own) {
        votes.set(i, updated);
        extra.put("votes", votes);
        return;
      }
    }
    votes.add(updated);
    extra.put("votes", votes);
  }

  static void recordReschedule(
      Map<String, Object> extra, Actor actor, Map<String, Object> interview) {
    var changes = new ArrayList<Object>();
    if (extra.get("changes") instanceof List<?> existing) changes.addAll(existing);
    var before = new LinkedHashMap<String, Object>();
    for (String field :
        List.of(
            "date",
            "start",
            "end",
            "interviewerIds",
            "interviewer",
            "method",
            "place",
            "status",
            "result",
            "evaluation"))
      if (interview.containsKey(field)) before.put(field, interview.get(field));
    changes.add(
        Db.map(
            "date",
            LocalDateTime.now(ZoneId.of("Asia/Shanghai")).toString(),
            "operatorId",
            actor.id(),
            "operator",
            actor.displayName(),
            "before",
            before));
    extra.put("changes", changes);
  }

  static void validateTimeline(Map<String, Object> body) {
    for (String field : List.of("date", "type", "title", "detail"))
      HrService.requireText(body, field);
    try {
      LocalDate.parse(Db.str(body, "date"));
    } catch (DateTimeException e) {
      throw ApiException.bad("成长记录日期格式须为 YYYY-MM-DD。");
    }
  }

  public Map<String, Object> interviewCheck(
      Actor actor, String candidate, Map<String, Object> body) {
    audit.require(actor, "interviews:write");
    var c = hr.raw(actor, "candidates", candidate, false);
    LocalDateTime from = parseTime(Db.str(body, "date"), Db.str(body, "start")),
        to = parseTime(Db.str(body, "date"), Db.str(body, "end"));
    if (!to.isAfter(from)) throw ApiException.bad("面试结束时间必须晚于开始时间。");
    if (!(body.get("interviewerIds") instanceof List<?> people) || people.isEmpty())
      throw ApiException.bad("请选择面试官。");
    List<Map<String, Object>> conflicts = new ArrayList<>();
    Set<Long> allowed = scope.orgs(actor);
    for (Object input : people) {
      long person = hr.ref("emps", input, true);
      hr.participantScope(actor, person);
      interviewerEligible(c, person);
      var rows =
          db.jdbc.queryForList(
              "SELECT i.scheduled_start,i.scheduled_end,c.name candidate_name,r.org_id FROM"
                  + " interview i JOIN interview_interviewer ii ON ii.interview_id=i.id JOIN"
                  + " candidate c ON c.id=i.candidate_id JOIN recruitment_request r ON"
                  + " r.id=c.request_id WHERE ii.employee_id=? AND i.candidate_id<>? AND"
                  + " i.status='SCHEDULED' AND i.scheduled_start<? AND i.scheduled_end>?",
              person,
              c.get("id"),
              to,
              from);
      for (var r : rows) {
        String start = HrService.stringDate(r.get("scheduled_start")),
            end = HrService.stringDate(r.get("scheduled_end"));
        conflicts.add(
            Db.map(
                "interviewerName",
                hr.employeeName(person),
                "candidateName",
                actor.all() || allowed.contains(Db.num(r.get("org_id")))
                    ? r.get("candidate_name")
                    : "其他部门面试",
                "date",
                start.substring(0, 10),
                "start",
                start.substring(11, 16),
                "end",
                end.substring(11, 16)));
      }
    }
    return Db.map("available", conflicts.isEmpty(), "conflicts", conflicts);
  }

  void interviewerEligible(Map<String, Object> candidate, long employee) {
    var request =
        db.one("SELECT org_id FROM recruitment_request WHERE id=?", candidate.get("request_id"));
    long org = Db.num(request.get("org_id"));
    var person =
        db.one(
            "SELECT e.org_id,o.name main_name FROM employee e LEFT JOIN org_department o ON"
                + " o.id=e.main_org_id WHERE e.id=?",
            employee);
    if (scope.within(Db.num(person.get("org_id")), org)
        || Db.str(person, "main_name").matches(".*(人事|人力|行政).*")) return;
    if (db.jdbc.queryForObject(
            "WITH RECURSIVE chain AS (SELECT id,parent_id,manager_employee_id FROM org_department"
                + " WHERE id=? UNION ALL SELECT p.id,p.parent_id,p.manager_employee_id FROM"
                + " org_department p JOIN chain c ON p.id=c.parent_id) SELECT COUNT(*) FROM chain"
                + " WHERE manager_employee_id=?",
            Integer.class,
            org,
            employee)
        > 0) return;
    throw ApiException.bad("面试官须属于需求部门、下级组织、组织链负责人或 HR 行政。");
  }

  void ensureOpenRequest(Map<String, Object> c) {
    var req =
        db.one("SELECT status,deleted_at FROM recruitment_request WHERE id=?", c.get("request_id"));
    if (req.get("deleted_at") != null || !"OPEN".equals(req.get("status")))
      throw ApiException.conflict("招聘需求已暂停、完成或关闭，不能继续推进。");
  }

  Map<String, Object> currentInterview(Map<String, Object> c, Map<String, Object> body) {
    String stage = Db.str(c, "stage");
    Object input = body.get("interviewId");
    Map<String, Object> i =
        input == null
            ? db.one(
                "SELECT * FROM interview WHERE candidate_id=? AND round_no=? FOR UPDATE",
                c.get("id"),
                stage.equals("FIRST_INTERVIEW") ? 1 : 2)
            : db.one(
                "SELECT * FROM interview WHERE id=? AND candidate_id=? FOR UPDATE",
                input,
                c.get("id"));
    if (i == null) throw ApiException.conflict("请先安排当前轮次面试。");
    if (Db.num(i.get("round_no")) != (stage.equals("FIRST_INTERVIEW") ? 1 : 2))
      throw ApiException.conflict("这不是当前轮次的面试。");
    return i;
  }

  void onboarding(Actor a, Map<String, Object> c, Map<String, Object> body) {
    audit.require(a, "offers:write");
    if (!"ONBOARDING".equals(c.get("stage"))) throw ApiException.conflict("候选人不在待入职阶段或已入职。");
    long id = Db.num(c.get("id"));
    var req =
        db.one("SELECT * FROM recruitment_request WHERE id=? FOR UPDATE", c.get("request_id"));
    var entry = db.one("SELECT * FROM onboarding_record WHERE candidate_id=? FOR UPDATE", id);
    if (entry == null) {
      db.insert("onboarding_record", Db.map("candidate_id", id, "created_by", a.id()));
      entry = db.one("SELECT * FROM onboarding_record WHERE candidate_id=? FOR UPDATE", id);
    }
    if (entry.get("employee_id") != null || "HIRED".equals(entry.get("result")))
      throw ApiException.conflict("此候选人已办理入职。");
    String action = Db.str(body, "action"),
        date = Db.str(body, "onboard"),
        reason = Db.str(body, "entryNotes");
    if (reason.isBlank()) reason = Db.str(body, "reason");
    String result =
        switch (action) {
          case "确认入职" -> "HIRED";
          case "延期入职", "调整入职日期" -> "POSTPONED";
          case "未到岗" -> "NO_SHOW";
          case "放弃入职" -> "DECLINED";
          case "取消入职" -> "CANCELLED";
          case "重新安排入职" -> "PENDING_ONBOARD";
          default -> throw ApiException.bad("入职操作无效。");
        };
    if (!action.equals("确认入职") && reason.isBlank()) throw ApiException.bad("请填写入职处理说明。");
    String current = Db.str(entry, "result");
    Set<String> allowed =
        switch (current) {
          case "PENDING_ONBOARD" -> Set.of("确认入职", "延期入职", "未到岗", "放弃入职", "取消入职");
          case "POSTPONED" -> Set.of("确认入职", "调整入职日期", "未到岗", "放弃入职", "取消入职");
          case "NO_SHOW" -> Set.of("重新安排入职", "放弃入职", "取消入职");
          case "DECLINED", "CANCELLED" -> Set.of("重新安排入职");
          default -> Set.of();
        };
    if (!allowed.contains(action)) throw ApiException.conflict("当前入职状态不允许此操作，请按可用流程处理。");
    validateOnboardingDate(c, body, result);
    Long employee = null;
    if (result.equals("HIRED")) {
      ensureOpenRequest(c);
      int hired =
          db.jdbc.queryForObject(
              "SELECT COUNT(*) FROM candidate WHERE request_id=? AND stage='HIRED'",
              Integer.class,
              c.get("request_id"));
      if (hired >= Db.num(req.get("headcount"))) throw ApiException.conflict("招聘需求名额已满。");
      var job = db.one("SELECT * FROM job_position WHERE id=? FOR UPDATE", req.get("job_id"));
      if (!"ACTIVE".equals(job.get("status")) || job.get("deleted_at") != null)
        throw ApiException.conflict("岗位已停用或归档。");
      hr.activeOrg(Db.num(job.get("org_id")));
      HrService.requireText(body, "employeeId");
      HrService.requireText(body, "grade");
      HrService.requireText(body, "workRegion");
      HrService.requireText(body, "workplace");
      HrService.requireText(body, "contractCompany");
      var draft =
          Db.map(
              "id",
              body.get("employeeId"),
              "name",
              c.get("name"),
              "phone",
              c.get("phone"),
              "email",
              c.get("email"),
              "dept",
              hr.code("orgs", job.get("org_id")),
              "job",
              hr.code("jobs", req.get("job_id")),
              "grade",
              body.get("grade"),
              "status",
              "试用",
              "entry",
              date,
              "workRegion",
              body.get("workRegion"),
              "workplace",
              body.get("workplace"),
              "contractCompany",
              body.get("contractCompany"),
              "source",
              "招聘入职",
              "education",
              c.get("education"));
      var person = hr.saveInternal(a, "emps", null, draft, false);
      employee = Db.num(person.get("dbId"));
      db.jdbc.update(
          "INSERT INTO"
              + " employee_file(employee_id,file_type,object_key,file_name,size_bytes,mime_type,uploaded_by)"
              + " SELECT ?, '入职材料',object_key,file_name,size_bytes,mime_type,? FROM candidate_file"
              + " WHERE candidate_id=? AND status='ACTIVE'",
          employee,
          a.id(),
          id);
      db.jdbc.update("UPDATE candidate SET stage='HIRED',version=version+1 WHERE id=?", id);
      if (hired + 1 >= Db.num(req.get("headcount")))
        db.jdbc.update(
            "UPDATE recruitment_request SET status='COMPLETED',version=version+1 WHERE id=?",
            req.get("id"));
      else
        db.jdbc.update(
            "UPDATE recruitment_request SET version=version+1 WHERE id=?", req.get("id"));
    } else db.jdbc.update("UPDATE candidate SET version=version+1 WHERE id=?", id);
    var candidateExtra = db.object(c.get("extra"));
    for (String field : List.of("workRegion", "workplace", "contractCompany"))
      if (body.containsKey(field) && !Db.str(body, field).isBlank())
        candidateExtra.put(field, body.get(field));
    if (body.containsKey("grade")) candidateExtra.put("contractGrade", body.get("grade"));
    db.jdbc.update("UPDATE candidate SET extra=? WHERE id=?", db.json(candidateExtra), id);
    db.jdbc.update(
        "UPDATE onboarding_record SET"
            + " result=?,planned_onboard_date=COALESCE(?,planned_onboard_date),actual_onboard_date=?,employee_id=?,remark=?,version=version+1"
            + " WHERE id=?",
        result,
        HrService.nullable(date),
        result.equals("HIRED") ? date : null,
        employee,
        reason,
        entry.get("id"));
    hr.stageLog(
        a,
        id,
        "ONBOARDING",
        result.equals("HIRED") ? "HIRED" : "ONBOARDING",
        action + "；" + reason);
  }

  static void validateOnboardingDate(
      Map<String, Object> candidate, Map<String, Object> body, String result) {
    boolean planned = Set.of("POSTPONED", "PENDING_ONBOARD").contains(result);
    if (!body.containsKey("onboard") && !planned && !result.equals("HIRED")) return;
    String date = Db.str(body, "onboard");
    if (date.isBlank()) throw ApiException.bad("请填写入职日期。");
    LocalDate day;
    try {
      day = LocalDate.parse(date);
    } catch (DateTimeException e) {
      throw ApiException.bad("入职日期格式须为 YYYY-MM-DD。");
    }
    if (day.isBefore(
        LocalDate.parse(HrService.stringDate(candidate.get("created_at")).substring(0, 10))))
      throw ApiException.bad("入职日期不能早于候选人录入日期。");
    if (planned && day.isBefore(LocalDate.now(ZoneId.of("Asia/Shanghai"))))
      throw ApiException.bad("新的计划入职日期不能早于今天。");
  }

  Map<String, Object> asset(Actor a, String code, String action, Map<String, Object> body) {
    audit.require(a, "assets:write");
    var row = hr.raw(a, "assets", code, true);
    String status = Db.str(row, "status");
    var patch = assetPatch(action, body);
    patch.put("version", row.get("version"));
    switch (action) {
      case "assign" -> {
        if (!status.equals("IDLE") || row.get("owner_employee_id") != null)
          throw ApiException.conflict("仅闲置资产可领用。");
        HrService.requireText(body, "owner");
        patch.put("status", "使用中");
        patch.put("public", "否");
      }
      case "return" -> {
        if (row.get("owner_employee_id") == null) throw ApiException.conflict("资产尚未领用。");
        patch.put("owner", "");
        patch.put("status", "闲置");
      }
      case "transfer" -> {
        if (!status.equals("IN_USE") || row.get("owner_employee_id") == null)
          throw ApiException.conflict("仅使用中的资产可以转移。");
        HrService.requireText(body, "owner");
        if (Db.str(body, "owner").equals(hr.code("emps", row.get("owner_employee_id"))))
          throw ApiException.bad("转移目标不能是当前使用人。");
        patch.put("status", "使用中");
      }
      case "repair-start" -> {
        if (!Set.of("IDLE", "IN_USE").contains(status)) throw ApiException.conflict("资产当前不能开始维修。");
        patch.put("status", "维修中");
      }
      case "repair-end" -> {
        if (!status.equals("REPAIRING")) throw ApiException.conflict("资产当前不在维修中。");
        patch.put("status", row.get("owner_employee_id") == null ? "闲置" : "使用中");
      }
      case "scrap" -> {
        if (row.get("owner_employee_id") != null) throw ApiException.conflict("资产须先归还，再报废。");
        patch.put("status", "已报废");
      }
      case "location" -> {}
      default -> throw new ApiException(404, "资产操作不存在。");
    }
    if (body.containsKey("version")) HrService.version(row, body);
    return hr.saveInternal(a, "assets", code, patch, false);
  }

  static Map<String, Object> assetPatch(String action, Map<String, Object> input) {
    var patch = new LinkedHashMap<String, Object>();
    for (String field : List.of("version", "location", "workRegion", "office", "reason"))
      if (input.containsKey(field)) patch.put(field, input.get(field));
    if (Set.of("assign", "transfer").contains(action) && input.containsKey("owner"))
      patch.put("owner", input.get("owner"));
    return HrService.normalizePatch("assets", patch);
  }

  Map<String, Object> employee(Actor a, String code, String action, Map<String, Object> body) {
    audit.require(a, "emps:write");
    var row = hr.raw(a, "emps", code, true);
    long id = Db.num(row.get("id"));
    if (action.equals("leave")) {
      if ("LEFT".equals(row.get("status"))) throw ApiException.conflict("员工已离职。");
      var patch = new LinkedHashMap<>(body);
      if (Db.str(patch, "leaveDate").isBlank())
        patch.put("leaveDate", LocalDate.now(ZoneId.of("Asia/Shanghai")).toString());
      patch.put("status", "已离职");
      if (!patch.containsKey("version")) patch.put("version", row.get("version"));
      return hr.saveInternal(a, "emps", code, patch, false, false, true);
    }
    if (action.equals("reinstate")) {
      if (!"LEFT".equals(row.get("status"))) throw ApiException.conflict("员工尚未离职。");
      var patch = new LinkedHashMap<String, Object>();
      patch.put("status", "正式");
      patch.put("leaveDate", "");
      patch.put("version", body.getOrDefault("version", row.get("version")));
      return hr.saveInternal(a, "emps", code, patch, false, true);
    }
    if (action.equals("timeline")) {
      validateTimeline(body);
      var event =
          Db.map(
              "date",
              body.get("date"),
              "title",
              body.get("title"),
              "detail",
              body.get("detail"),
              "manual",
              true);
      db.insert(
          "employee_change_log",
          Db.map(
              "employee_id",
              id,
              "change_type",
              body.get("type"),
              "after_json",
              db.json(event),
              "operator_user_id",
              a.id()));
      audit.record(a, "GROWTH_CREATE", "emps", id, null, null);
      return hr.view("emps", row);
    }
    if (action.equals("timeline-delete") || action.equals("timeline-update")) {
      long event = Db.num(body.get("timelineId"));
      var log =
          db.one(
              "SELECT * FROM employee_change_log WHERE id=? AND employee_id=? AND deleted_at IS"
                  + " NULL FOR UPDATE",
              event,
              id);
      if (log == null) throw new ApiException(404, "成长记录不存在。");
      if (!Boolean.TRUE.equals(db.object(log.get("after_json")).get("manual")))
        throw ApiException.bad("系统生成的变更记录不可修改。");
      if (action.equals("timeline-delete"))
        db.jdbc.update(
            "UPDATE employee_change_log SET deleted_at=UTC_TIMESTAMP() WHERE id=?", event);
      else {
        validateTimeline(body);
        db.jdbc.update(
            "UPDATE employee_change_log SET change_type=?,after_json=? WHERE id=?",
            body.get("type"),
            db.json(
                Db.map(
                    "manual",
                    true,
                    "date",
                    body.get("date"),
                    "title",
                    body.get("title"),
                    "detail",
                    body.get("detail"))),
            event);
      }
      audit.record(a, action, "emps", id, null, null);
      return hr.view("emps", row);
    }
    throw new ApiException(404, "员工操作不存在。");
  }
}

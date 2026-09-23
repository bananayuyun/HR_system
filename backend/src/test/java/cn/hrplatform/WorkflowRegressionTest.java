package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class WorkflowRegressionTest {
  final Actor admin = new Actor(1, "admin", "许 HR", List.of(), List.of(), null, "", "ALL");
  final Actor manager =
      new Actor(2, "manager", "林主管", List.of(), List.of(), 18L, "ORG_18", "SELF_ORG_TREE");

  @Test
  void votesAppendAndOnlyTheSameOperatorIsUpdated() {
    var extra = new LinkedHashMap<String, Object>();
    WorkflowService.recordVote(extra, manager, "待定", "主管意见");
    WorkflowService.recordVote(extra, admin, "待定", "HR 意见");
    WorkflowService.recordVote(extra, manager, "通过", "最终通过");
    var votes = (List<Map<String, Object>>) extra.get("votes");
    assertEquals(2, votes.size());
    assertEquals("通过", votes.get(0).get("result"));
    assertEquals("最终通过", votes.get(0).get("evaluation"));
    assertEquals("HR 意见", votes.get(1).get("evaluation"));
  }

  @Test
  void legacyDisplayNameVoteIsUpgradedWithoutDuplication() {
    var extra = Db.map("votes", List.of(Db.map("operator", "许 HR", "result", "待定")));
    WorkflowService.recordVote(extra, admin, "通过", "已核对");
    var votes = (List<Map<String, Object>>) extra.get("votes");
    assertEquals(1, votes.size());
    assertEquals(1L, votes.get(0).get("operatorId"));
  }

  @Test
  void rescheduleHistoryAppendsSnapshotsWithoutRecursiveChanges() {
    var extra = new LinkedHashMap<String, Object>();
    var original =
        Db.map(
            "date",
            "2026-09-23",
            "start",
            "09:00",
            "end",
            "10:00",
            "interviewerIds",
            List.of("E0002"),
            "method",
            "线上",
            "place",
            "会议室",
            "changes",
            List.of("ignored"));
    WorkflowService.recordReschedule(extra, admin, original);
    WorkflowService.recordReschedule(
        extra, admin, Db.map("date", "2026-09-24", "interviewerIds", List.of("E0005")));
    var changes = (List<Map<String, Object>>) extra.get("changes");
    assertEquals(2, changes.size());
    var before = (Map<String, Object>) changes.get(0).get("before");
    assertEquals(List.of("E0002"), before.get("interviewerIds"));
    assertEquals("09:00", before.get("start"));
    assertFalse(before.containsKey("changes"));
  }

  @Test
  void timelineCreateAndUpdateShareAllRequiredFieldChecks() {
    for (String field : List.of("date", "type", "title", "detail")) {
      var event = Db.map("date", "2026-09-23", "type", "晋升", "title", "标题", "detail", "说明");
      event.put(field, "");
      assertEquals(
          400,
          assertThrows(ApiException.class, () -> WorkflowService.validateTimeline(event)).status);
    }
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () ->
                    WorkflowService.validateTimeline(
                        Db.map("date", "not-a-date", "type", "晋升", "title", "标题", "detail", "说明")))
            .status);
  }

  @Test
  void batchRejectsEmptyOversizedRepeatedAndInvalidIds() {
    for (Object input :
        List.of(
            List.of(),
            Collections.nCopies(201, "C1"),
            List.of("C1", " C1 "),
            List.of(""),
            List.of(123)))
      assertEquals(
          400, assertThrows(ApiException.class, () -> WorkflowService.batchIds(input)).status);
    assertEquals(List.of("C2", "C1"), WorkflowService.batchIds(List.of("C2", "C1")));
  }

  @Test
  void invalidLaterCandidatePreventsAllBusinessWrites() {
    var jdbc = mock(JdbcTemplate.class);
    var hr = mock(HrService.class);
    when(hr.database()).thenReturn(new Db(jdbc, new ObjectMapper()));
    when(hr.auditor()).thenReturn(mock(Audit.class));
    when(hr.raw(admin, "candidates", "C1", true))
        .thenReturn(Db.map("id", 1L, "request_id", 9L, "stage", "HR_SCREEN"));
    when(hr.raw(admin, "candidates", "C2", true))
        .thenReturn(Db.map("id", 2L, "request_id", 9L, "stage", "HIRED"));
    when(jdbc.queryForList("SELECT status,deleted_at FROM recruitment_request WHERE id=?", 9L))
        .thenReturn(List.of(Db.map("status", "OPEN")));
    var workflows = new WorkflowService(hr);
    assertEquals(
        409,
        assertThrows(
                ApiException.class,
                () ->
                    workflows.batchScreening(
                        admin, Db.map("ids", List.of("C2", "C1"), "result", "通过")))
            .status);
    verify(jdbc, never()).update(anyString(), any(Object[].class));
    verify(hr, never()).stageLog(any(), anyLong(), anyString(), anyString(), anyString());
  }

  @Test
  void nonAssignedManagerFailsPreflightWithoutWriting() {
    var jdbc = mock(JdbcTemplate.class);
    var hr = mock(HrService.class);
    var audit = mock(Audit.class);
    when(hr.database()).thenReturn(new Db(jdbc, new ObjectMapper()));
    when(hr.auditor()).thenReturn(audit);
    when(jdbc.queryForObject(
            contains("FROM request_participant"), eq(Integer.class), eq(9L), eq(2L)))
        .thenReturn(0);
    when(jdbc.queryForList("SELECT status,deleted_at FROM recruitment_request WHERE id=?", 9L))
        .thenReturn(List.of(Db.map("status", "OPEN")));
    when(hr.raw(manager, "candidates", "C1", true))
        .thenReturn(Db.map("id", 1L, "request_id", 9L, "stage", "DEPT_SCREEN"));
    var workflows = new WorkflowService(hr);
    assertEquals(
        403,
        assertThrows(
                ApiException.class,
                () ->
                    workflows.batchScreening(manager, Db.map("ids", List.of("C1"), "result", "通过")))
            .status);
    verify(jdbc, never()).update(anyString(), any(Object[].class));
    verify(audit).denied(manager, "screening", 1L);
  }
}

package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class WorkTypeAndEntryDateTest {
  final Map<String, Object> candidate = Db.map("created_at", "2026-01-01 00:00:00");

  @Test
  void allSixWorkTypesRoundTripWithoutChangingOldCodes() {
    for (var entry :
        Map.of(
                "全职",
                "FULL_TIME",
                "兼职",
                "PART_TIME",
                "外包",
                "OUTSOURCED",
                "实习",
                "INTERN",
                "劳务派遣",
                "LABOR_DISPATCH",
                "其它",
                "OTHER")
            .entrySet()) {
      assertEquals(
          entry.getValue(), EntitySchema.from(EntitySchema.EMP_TYPE, entry.getKey(), "FULL_TIME"));
      assertEquals(entry.getKey(), EntitySchema.to(EntitySchema.EMP_TYPE, entry.getValue()));
    }
  }

  @Test
  void unknownWorkTypeIsAnInputErrorRatherThanFullTime() {
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () -> EntitySchema.from(EntitySchema.EMP_TYPE, "UNKNOWN", "FULL_TIME"))
            .status);
    assertEquals("FULL_TIME", EntitySchema.from(EntitySchema.EMP_TYPE, null, "FULL_TIME"));
  }

  @Test
  void auditSnapshotsPreserveBothNewWorkTypeCodes() {
    var service =
        new HrService(
            new Db(mock(JdbcTemplate.class), new ObjectMapper()),
            mock(Scope.class),
            mock(Audit.class),
            mock(Crypto.class));
    assertEquals(
        "LABOR_DISPATCH",
        service.canonicalAuditSnapshot(Db.map("workType", "劳务派遣")).get("employee_type"));
    assertEquals(
        "OTHER",
        service
            .canonicalAuditSnapshot(Db.map("employee_type", "OTHER", "workType", "其它"))
            .get("employee_type"));
  }

  @Test
  void auditDisplayUsesTheSameSixWorkTypeLabelsAsEmployeeReadback() {
    var service =
        new HrService(
            new Db(mock(JdbcTemplate.class), new ObjectMapper()),
            mock(Scope.class),
            mock(Audit.class),
            mock(Crypto.class));
    for (var entry : EntitySchema.EMP_TYPE.entrySet())
      assertEquals(entry.getKey(), service.auditValue("employee_type", entry.getValue()));
    assertEquals("未填写", service.auditValue("employee_type", null));
  }

  @Test
  void everyOnboardingResultRejectsDatesEarlierThanCandidateCreation() {
    for (String result :
        List.of("HIRED", "POSTPONED", "PENDING_ONBOARD", "NO_SHOW", "DECLINED", "CANCELLED"))
      assertEquals(
          400,
          assertThrows(
                  ApiException.class,
                  () ->
                      WorkflowService.validateOnboardingDate(
                          candidate, Db.map("onboard", "2000-01-01"), result))
              .status);
  }

  @Test
  void everyOnboardingResultRejectsMalformedOrExplicitBlankDates() {
    for (String result :
        List.of("HIRED", "POSTPONED", "PENDING_ONBOARD", "NO_SHOW", "DECLINED", "CANCELLED"))
      for (String date : List.of("not-a-date", "2026-99-99", ""))
        assertEquals(
            400,
            assertThrows(
                    ApiException.class,
                    () ->
                        WorkflowService.validateOnboardingDate(
                            candidate, Db.map("onboard", date), result))
                .status);
  }

  @Test
  void specialCancellationWithoutADateRemainsValid() {
    assertDoesNotThrow(
        () -> WorkflowService.validateOnboardingDate(candidate, Map.of(), "CANCELLED"));
  }

  @Test
  void plannedOrConfirmedOnboardingStillRequiresADate() {
    for (String result : List.of("HIRED", "POSTPONED", "PENDING_ONBOARD"))
      assertEquals(
          400,
          assertThrows(
                  ApiException.class,
                  () -> WorkflowService.validateOnboardingDate(candidate, Map.of(), result))
              .status);
  }

  @Test
  void futureHiringRemainsAllowedButNewPlansCannotBeInThePast() {
    var oldCandidate = Db.map("created_at", "2000-01-01 00:00:00");
    String tomorrow = LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString();
    assertDoesNotThrow(
        () ->
            WorkflowService.validateOnboardingDate(
                oldCandidate, Db.map("onboard", tomorrow), "HIRED"));
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () ->
                    WorkflowService.validateOnboardingDate(
                        oldCandidate, Db.map("onboard", "2001-01-01"), "POSTPONED"))
            .status);
  }
}

package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class DepartmentManagerScopeTest {
  @Test
  void unrelatedDepartmentCannotBeReadEditedOrDownloaded() {
    var jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(startsWith("WITH RECURSIVE tree"), eq(Long.class), eq(18L)))
        .thenReturn(List.of(18L, 19L));
    var db =
        new Db(jdbc, new ObjectMapper()) {
          @Override
          public Map<String, Object> one(String sql, Object... args) {
            if (sql.startsWith("SELECT * FROM recruitment_request WHERE request_no="))
              return Db.map(
                  "id", "OWN".equals(args[0]) ? 7L : 8L,
                  "request_no", args[0],
                  "org_id", "OWN".equals(args[0]) ? 19L : 30L);
            if (sql.startsWith("SELECT * FROM candidate_file WHERE id="))
              return Db.map("id", 5L, "candidate_id", 9L, "status", "ACTIVE");
            if (sql.startsWith("SELECT code value FROM candidate WHERE id="))
              return Map.of("value", "CROSS");
            if (sql.startsWith("SELECT * FROM candidate WHERE code="))
              return Db.map("id", 9L, "code", "CROSS", "request_id", 8L);
            if (sql.startsWith("SELECT org_id FROM recruitment_request WHERE id="))
              return Map.of("org_id", 30L);
            return null;
          }
        };
    var audit = mock(Audit.class);
    var scope = new Scope(db, audit);
    var hr = new HrService(db, scope, audit, mock(Crypto.class));
    var files = new FilesService(hr, ".");
    var manager =
        new Actor(
            2L,
            "manager",
            "主管",
            List.of("DEPT_MANAGER"),
            List.of("reqs:read", "reqs:write", "screening:read"),
            18L,
            "ORG_18",
            "SELF_ORG_TREE");

    assertEquals(19L, hr.raw(manager, "reqs", "OWN", false).get("org_id"));
    assertEquals(
        403,
        assertThrows(ApiException.class, () -> hr.raw(manager, "reqs", "CROSS", false)).status);
    assertEquals(
        403,
        assertThrows(
                ApiException.class, () -> hr.save(manager, "reqs", "CROSS", Map.of("version", 0)))
            .status);
    assertEquals(
        403,
        assertThrows(ApiException.class, () -> files.download(manager, "candidates", 5L, false))
            .status);
  }

  @Test
  void unrelatedDepartmentParticipantIsRejected() {
    var jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForList(startsWith("WITH RECURSIVE tree"), eq(Long.class), eq(18L)))
        .thenReturn(List.of(18L, 19L));
    when(jdbc.queryForObject(
            startsWith("WITH RECURSIVE chain"), eq(Integer.class), eq(18L), eq(99L)))
        .thenReturn(0);
    var db =
        new Db(jdbc, new ObjectMapper()) {
          @Override
          public Map<String, Object> one(String sql, Object... args) {
            if (sql.startsWith("SELECT e.org_id,o.name main_name FROM employee"))
              return Map.of("org_id", 30L, "main_name", "销售部");
            return null;
          }
        };
    var audit = mock(Audit.class);
    var hr = new HrService(db, new Scope(db, audit), audit, mock(Crypto.class));
    var manager =
        new Actor(
            2L,
            "manager",
            "主管",
            List.of("DEPT_MANAGER"),
            List.of(),
            18L,
            "ORG_18",
            "SELF_ORG_TREE");

    assertEquals(
        403, assertThrows(ApiException.class, () -> hr.participantScope(manager, 99L)).status);
    verify(audit).denied(manager, "REQUEST_PARTICIPANT", 99L);
  }
}

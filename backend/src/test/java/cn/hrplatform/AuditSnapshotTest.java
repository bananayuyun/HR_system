package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class AuditSnapshotTest {
  private final Db db = new Db(mock(JdbcTemplate.class), new ObjectMapper());
  private final HrService service =
      new HrService(db, mock(Scope.class), mock(Audit.class), mock(Crypto.class));

  @Test
  void snapshotsIncludeEditableNotesAndFlattenAllowedExtra() {
    var snapshot =
        service.safeSnapshot(
            Db.map(
                "remark",
                "变更后的备注",
                "extra",
                db.json(Map.of("description", "岗位职责说明", "sequence", "技术序列 T"))));
    assertEquals("变更后的备注", snapshot.get("remark"));
    assertEquals("岗位职责说明", snapshot.get("description"));
    assertEquals("技术序列 T", snapshot.get("sequence"));
    assertFalse(snapshot.containsKey("extra"));
  }

  @Test
  void snapshotsDoNotDuplicateSensitiveFieldsOrUntrustedExtra() {
    var snapshot =
        service.safeSnapshot(
            Db.map(
                "phone",
                "13900001000",
                "email",
                "private@example.test",
                "id_no_cipher",
                new byte[] {1, 2},
                "extra",
                db.json(
                    Map.of(
                        "identityNumber",
                        "PRIVATE-ID",
                        "bankNumber",
                        "PRIVATE-BANK",
                        "roles",
                        "HR_ADMIN",
                        "notes",
                        "普通备注"))));
    String json = db.json(snapshot);
    assertFalse(json.contains("PRIVATE"));
    assertFalse(json.contains("13900001000"));
    assertFalse(json.contains("private@example.test"));
    assertFalse(snapshot.containsKey("roles"));
    assertEquals("普通备注", snapshot.get("remark"));
  }

  @Test
  void snapshotsUseCanonicalFieldsWithoutDisplayOnlyChanges() {
    var snapshot =
        service.safeSnapshot(
            Db.map(
                "location", "华东",
                "company", "公司甲",
                "employee_type", "FULL_TIME",
                "verification", "UNVERIFIED",
                "remark", "备注",
                "extra",
                    db.json(
                        Map.of(
                            "workRegion", "华东",
                            "contractCompany", "公司甲",
                            "workType", "全职",
                            "verification", "未认证",
                            "notes", "备注"))));
    assertEquals("UNVERIFIED", snapshot.get("verification"));
    assertEquals("FULL_TIME", snapshot.get("employee_type"));
    assertEquals(5, snapshot.size());
    assertEquals(
        snapshot,
        service.canonicalAuditSnapshot(
            Db.map(
                "workRegion", "华东",
                "contractCompany", "公司甲",
                "workType", "全职",
                "verification", "未认证",
                "notes", "备注")));
  }
}

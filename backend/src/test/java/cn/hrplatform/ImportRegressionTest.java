package cn.hrplatform;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class ImportRegressionTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final Db db = new Db(jdbc, new ObjectMapper());
  private final Crypto crypto = new Crypto(Base64.getEncoder().encodeToString(new byte[32]));
  private final HrService hr = new HrService(db, mock(Scope.class), mock(Audit.class), crypto);

  @Test
  void canonicalRegionSurvivesTheSecondNormalization() {
    var row = Db.map("workRegion", "旧片区", "location", "旧片区");
    ImportService.canonicalDictionaryValue(row, "location", "新片区");
    HrService.normalize(row);
    assertEquals("新片区", row.get("location"));
    assertEquals("新片区", row.get("workRegion"));
  }

  @Test
  void canonicalCompanySurvivesTheSecondNormalization() {
    var row = Db.map("contractCompany", "旧公司", "company", "旧公司");
    ImportService.canonicalDictionaryValue(row, "company", "新公司");
    HrService.normalize(row);
    assertEquals("新公司", row.get("company"));
    assertEquals("新公司", row.get("contractCompany"));
  }

  @Test
  void canonicalCoreOnlyInputOverridesAnExistingAliasWhenMerged() {
    var input = Db.map("location", "新片区", "company", "新公司");
    ImportService.canonicalDictionaryValue(input, "location", "新片区");
    ImportService.canonicalDictionaryValue(input, "company", "新公司");
    var existing = Db.map("workRegion", "原片区", "contractCompany", "原公司");
    existing.putAll(input);
    HrService.normalize(existing);
    assertEquals("新片区", existing.get("location"));
    assertEquals("新公司", existing.get("company"));
  }

  @Test
  void missingDictionaryFieldsAreNotInjectedByNormalization() {
    var patch = Db.map("notes", "仅更新备注");
    HrService.normalize(patch);
    assertEquals(Map.of("notes", "仅更新备注"), patch);
  }

  @Test
  void householdTypeIsPersistedInTheExistingSensitiveColumnAndPayload() {
    hr.saveSensitive(123L, Db.map("householdType", "城镇"));
    var arguments = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc).update(contains("household_type=VALUES(household_type)"), arguments.capture());
    Object[] values = arguments.getValue();
    assertEquals("城镇", values[9]);
    assertEquals("城镇", db.object(crypto.decrypt((byte[]) values[10])).get("householdType"));
    assertTrue(HrService.SENSITIVE.contains("householdType"));
    assertFalse(
        hr.safeSnapshot(Db.map("extra", db.json(Map.of("householdType", "城镇"))))
            .containsKey("householdType"));
  }

  @Test
  void existingColumnIsReadableWithoutAnEncryptedExtension() {
    assertEquals("农村", hr.sensitiveData(Db.map("household_type", "农村")).get("householdType"));
  }

  @Test
  void unrelatedSensitiveUpdatePreservesHouseholdType() {
    when(jdbc.queryForList("SELECT * FROM employee_sensitive WHERE employee_id=?", 123L))
        .thenReturn(List.of(Db.map("household_type", "农村")));
    hr.saveSensitive(123L, Db.map("fundAccount", "QA123"));
    var arguments = ArgumentCaptor.forClass(Object[].class);
    verify(jdbc).update(contains("INSERT INTO"), arguments.capture());
    assertEquals("农村", arguments.getValue()[9]);
  }

  @Test
  void maskedHouseholdTypeDoesNotOverwriteOrCreateSensitiveData() {
    hr.saveSensitive(123L, Db.map("householdType", "••••"));
    verify(jdbc, never()).update(anyString(), any(Object[].class));
  }

  @Test
  void oversizedHouseholdTypeIsRejectedBeforeSql() {
    assertEquals(
        400,
        assertThrows(
                ApiException.class,
                () -> hr.saveSensitive(123L, Db.map("householdType", "字".repeat(65))))
            .status);
    verify(jdbc, never()).update(anyString(), any(Object[].class));
  }
}

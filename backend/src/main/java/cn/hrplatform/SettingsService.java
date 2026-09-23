package cn.hrplatform;

import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettingsService {
  final HrService hr;
  final Db db;
  final Audit audit;
  static final Map<String, String> DICTS =
      Map.of(
          "workRegion",
          "WORK_REGION",
          "workplace",
          "WORKPLACE",
          "contractCompany",
          "CONTRACT_COMPANY");

  SettingsService(HrService hr) {
    this.hr = hr;
    this.db = hr.database();
    this.audit = hr.auditor();
  }

  public Object get(Actor a, String key) {
    if (DICTS.containsKey(key)) return Db.map("items", hr.settings().get(key));
    if (key.equals("reminders")) {
      audit.require(a, "settings:read");
      return db.object(
          db.one("SELECT value_json FROM sys_setting WHERE setting_key='rules'").get("value_json"));
    }
    if (key.equals("sequences")) return Db.map("items", hr.sequences());
    throw new ApiException(404, "设置不存在。");
  }

  @Transactional
  public Object put(Actor a, String key, Map<String, Object> body) {
    audit.require(a, "settings:write");
    if (DICTS.containsKey(key)) {
      if (!(body.get("items") instanceof List<?> items)) throw ApiException.bad("字典项目须为数组。");
      long dict =
          Db.num(
              db.one("SELECT id FROM base_dictionary WHERE dict_code=?", DICTS.get(key)).get("id"));
      Set<Long> seen = new HashSet<>();
      Set<String> names = new HashSet<>();
      int order = 0;
      for (Object item : items) {
        var m = db.object(item);
        String name = Db.str(m, "name");
        if (name.isBlank() || name.length() > 128) throw ApiException.bad("字典名称必须为 1 至 128 字。");
        if (!names.add(name)) throw ApiException.bad("同一字典名称不能重复。");
        String status = HrService.active(m.get("status"));
        var old =
            m.get("id") == null
                ? null
                : db.one(
                    "SELECT * FROM base_dictionary_item WHERE id=? AND dictionary_id=? FOR UPDATE",
                    m.get("id"),
                    dict);
        long id;
        if (old == null)
          id =
              db.insert(
                  "base_dictionary_item",
                  Db.map(
                      "dictionary_id",
                      dict,
                      "item_code",
                      key.toUpperCase() + "_" + UUID.randomUUID().toString().substring(0, 12),
                      "item_name",
                      name,
                      "sort_no",
                      order,
                      "status",
                      status));
        else {
          id = Db.num(old.get("id"));
          String previous = Db.str(old, "item_name");
          List<String> aliases = new ArrayList<>();
          try {
            if (old.get("aliases") != null)
              aliases.addAll(db.json.readValue(Db.str(old, "aliases"), List.class));
          } catch (Exception ignored) {
          }
          if (!name.equals(previous)) {
            if (!aliases.contains(previous)) aliases.add(previous);
            rename(key, previous, name);
          }
          db.jdbc.update(
              "UPDATE base_dictionary_item SET item_name=?,sort_no=?,status=?,aliases=? WHERE id=?",
              name,
              order,
              status,
              db.json(aliases),
              id);
        }
        seen.add(id);
        order++;
      }
      for (var old :
          db.jdbc.queryForList("SELECT id FROM base_dictionary_item WHERE dictionary_id=?", dict))
        if (!seen.contains(Db.num(old.get("id"))))
          db.jdbc.update(
              "UPDATE base_dictionary_item SET status='INACTIVE' WHERE id=?", old.get("id"));
      audit.record(a, "DICTIONARY_UPDATE", key, dict, null, Db.map("count", items.size()));
      return get(a, key);
    }
    if (key.equals("sequences")) return putSequences(a, body);
    if (key.equals("reminders")) {
      var times = reminderTimes(body.get("times"));
      var safe =
          Db.map(
              "enabled",
              Boolean.TRUE.equals(body.get("enabled")),
              "workdays",
              Boolean.TRUE.equals(body.get("workdays")),
              "times",
              times,
              "channel",
              "站内待办",
              "lastPreview",
              java.time.LocalDateTime.now().toString());
      store("rules", safe);
      audit.record(a, "REMINDERS_UPDATE", "settings", null, null, safe);
      return safe;
    }
    throw new ApiException(404, "设置不存在。");
  }

  private Object putSequences(Actor actor, Map<String, Object> body) {
    if (body.containsKey("items") && body.containsKey("rename"))
      throw ApiException.bad("列表维护与序列改名请分别提交。");
    db.jdbc.update(
        "INSERT IGNORE INTO sys_setting(setting_key,value_json) VALUES('sequences',?)",
        db.json(hr.sequences()));
    db.one("SELECT value_json FROM sys_setting WHERE setting_key='sequences' FOR UPDATE");
    var previous = hr.sequences();
    List<String> items;
    if (body.containsKey("rename")) {
      if (!(body.get("rename") instanceof Map<?, ?> rename))
        throw ApiException.bad("序列改名须包含 from 和 to。");
      String from = sequenceName(rename.get("from")), to = sequenceName(rename.get("to"));
      if (!previous.contains(from)) throw new ApiException(404, "待改名序列不存在。");
      if (from.equals(to)) return Db.map("items", previous);
      if (previous.contains(to)) throw ApiException.conflict("序列名称已存在。");
      items = previous.stream().map(name -> name.equals(from) ? to : name).toList();
      for (var resource : Map.of("grade", "grades", "job_position", "jobs").entrySet()) {
        String table = resource.getKey();
        var rows =
            db.jdbc.queryForList(
                "SELECT id FROM "
                    + table
                    + " WHERE JSON_UNQUOTE(JSON_EXTRACT(extra,'$.sequence'))=? FOR UPDATE",
                from);
        for (var row : rows) {
          long id = Db.num(row.get("id"));
          db.jdbc.update(
              "UPDATE "
                  + table
                  + " SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),'$.sequence',?),"
                  + " version=version+1 WHERE id=?",
              to,
              id);
          audit.record(
              actor,
              "SEQUENCE_RENAME",
              resource.getValue(),
              id,
              Db.map("sequence", from),
              Db.map("sequence", to));
        }
      }
    } else {
      items = sequenceItems(body.get("items"));
      for (String table : List.of("grade", "job_position"))
        for (String used :
            db.jdbc.queryForList(
                "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(extra,'$.sequence')) FROM "
                    + table
                    + " WHERE JSON_EXTRACT(extra,'$.sequence') IS NOT NULL",
                String.class))
          if (!used.isBlank() && !items.contains(used))
            throw ApiException.conflict("序列仍被岗位或职级使用：" + used);
    }
    store("sequences", items);
    audit.record(
        actor,
        body.containsKey("rename") ? "SEQUENCE_RENAME" : "SEQUENCES_UPDATE",
        "settings",
        null,
        Db.map("items", previous),
        Db.map("items", items));
    return Db.map("items", items);
  }

  static List<String> sequenceItems(Object value) {
    if (!(value instanceof List<?> input) || input.isEmpty() || input.size() > 100)
      throw ApiException.bad("须保留 1 至 100 个序列。");
    var names = new LinkedHashSet<String>();
    for (Object item : input)
      if (!names.add(sequenceName(item))) throw ApiException.bad("序列名称不能重复。");
    return new ArrayList<>(names);
  }

  static String sequenceName(Object value) {
    if (!(value instanceof String name) || name.isBlank() || name.trim().length() > 128)
      throw ApiException.bad("序列名称必须为 1 至 128 字。");
    return name.trim();
  }

  static List<String> reminderTimes(Object value) {
    if (!(value instanceof List<?> input) || input.isEmpty() || input.size() > 3)
      throw ApiException.bad("请配置 1 至 3 个提醒时间。");
    var times = new ArrayList<String>();
    for (Object item : input) {
      if (!(item instanceof String time) || !time.matches("(?:[01]\\d|2[0-3]):[0-5]\\d"))
        throw ApiException.bad("提醒时间须为有效的 HH:mm 格式。");
      if (times.contains(time)) throw ApiException.bad("提醒时间不能重复。");
      times.add(time);
    }
    return times;
  }

  void store(String key, Object value) {
    db.jdbc.update(
        "INSERT INTO sys_setting(setting_key,value_json) VALUES(?,?) ON DUPLICATE KEY UPDATE"
            + " value_json=VALUES(value_json),version=version+1",
        key,
        db.json(value));
  }

  @Transactional
  public void delete(Actor actor, String key, long itemId) {
    audit.require(actor, "settings:write");
    if (!DICTS.containsKey(key)) throw new ApiException(404, "字典不存在。");
    var item =
        db.one(
            "SELECT i.* FROM base_dictionary_item i JOIN base_dictionary d ON d.id=i.dictionary_id"
                + " WHERE d.dict_code=? AND i.id=? FOR UPDATE",
            DICTS.get(key),
            itemId);
    if (item == null) throw new ApiException(404, "字典项不存在。");
    String name = Db.str(item, "item_name");
    List<String> names = new ArrayList<>();
    names.add(name);
    try {
      if (item.get("aliases") != null)
        names.addAll(db.json.readValue(Db.str(item, "aliases"), List.class));
    } catch (Exception ignored) {
    }
    for (String value : names) {
      var columns =
          key.equals("workRegion")
              ? Map.of(
                  "employee",
                  "location",
                  "job_position",
                  "location",
                  "recruitment_request",
                  "location",
                  "asset",
                  "location",
                  "org_department",
                  "location")
              : key.equals("workplace")
                  ? Map.of("employee", "workplace", "asset", "office")
                  : Map.of("employee", "company", "recruitment_request", "company");
      for (var table : columns.entrySet())
        if (db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table.getKey() + " WHERE " + table.getValue() + "=?",
                Integer.class,
                value)
            > 0) throw ApiException.conflict("该字典项已被业务记录使用，只能停用，不能删除。");
      for (String table :
          List.of(
              "employee",
              "job_position",
              "recruitment_request",
              "candidate",
              "asset",
              "org_department"))
        if (db.jdbc.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE JSON_UNQUOTE(JSON_EXTRACT(extra,?))=?",
                Integer.class,
                "$." + key,
                value)
            > 0) throw ApiException.conflict("该字典项已被业务记录使用，只能停用，不能删除。");
      if (db.jdbc.queryForObject(
              "SELECT COUNT(*) FROM audit_log WHERE JSON_SEARCH(before_json,'one',?) IS NOT NULL OR"
                  + " (resource_type<>'settings' AND JSON_SEARCH(after_json,'one',?) IS NOT NULL)",
              Integer.class,
              value,
              value)
          > 0) throw ApiException.conflict("该字典项有历史业务引用，只能停用，不能删除。");
    }
    db.jdbc.update("DELETE FROM base_dictionary_item WHERE id=?", itemId);
    audit.record(
        actor,
        "DICTIONARY_DELETE",
        "settings",
        itemId,
        Db.map("dictionary", key, "name", name),
        null);
  }

  void rename(String key, String old, String name) {
    if (key.equals("workRegion")) {
      for (String table :
          List.of("employee", "job_position", "recruitment_request", "asset", "org_department"))
        db.jdbc.update(
            "UPDATE " + table + " SET location=?,version=version+1 WHERE location=?", name, old);
    }
    if (key.equals("workplace")) {
      db.jdbc.update(
          "UPDATE employee SET workplace=?,version=version+1 WHERE workplace=?", name, old);
      db.jdbc.update("UPDATE asset SET office=?,version=version+1 WHERE office=?", name, old);
    }
    if (key.equals("contractCompany")) {
      for (String table : List.of("employee", "recruitment_request"))
        db.jdbc.update(
            "UPDATE " + table + " SET company=?,version=version+1 WHERE company=?", name, old);
    }
    for (String table :
        List.of(
            "employee",
            "job_position",
            "recruitment_request",
            "candidate",
            "asset",
            "org_department"))
      db.jdbc.update(
          "UPDATE "
              + table
              + " SET extra=JSON_SET(COALESCE(extra,JSON_OBJECT()),?,?,?,?),version=version+1 WHERE"
              + " JSON_UNQUOTE(JSON_EXTRACT(extra,?))=?",
          "$." + key,
          name,
          "$."
              + (key.equals("workRegion")
                  ? "location"
                  : key.equals("contractCompany") ? "company" : "workplace"),
          name,
          "$." + key,
          old);
  }

  @Transactional
  public void export(Actor a, Map<String, Object> body) {
    audit.require(a, "exports:read");
    String type = Db.str(body, "type");
    EntitySchema.get(type);
    if (!(body.get("ids") instanceof List<?> ids)) throw ApiException.bad("导出须提供记录编码列表。");
    if (ids.size() > 10000) throw ApiException.bad("单次导出最多 10000 条。");
    for (Object id : ids) hr.raw(a, type, Db.text(id), false);
    audit.record(
        a,
        "EXPORT",
        type,
        null,
        null,
        Db.map("ids", ids, "columns", body.getOrDefault("columns", List.of())));
  }

  public Object preferences(Actor a, String page) {
    var row =
        db.one("SELECT value_json FROM sys_setting WHERE setting_key=?", preferenceKey(a, page));
    return row == null ? Map.of() : db.object(row.get("value_json"));
  }

  @Transactional
  public Object preferences(Actor a, String page, Map<String, Object> body) {
    if (db.json(body).length() > 50000) throw ApiException.bad("个人视图设置过大。");
    String key = preferenceKey(a, page);
    db.jdbc.update(
        "INSERT IGNORE INTO sys_setting(setting_key,value_json) VALUES(?,JSON_OBJECT())", key);
    var row = db.one("SELECT value_json FROM sys_setting WHERE setting_key=? FOR UPDATE", key);
    var merged = db.object(row.get("value_json"));
    merged.putAll(body);
    if (db.json(merged).length() > 50000) throw ApiException.bad("个人视图设置过大。");
    store(key, merged);
    return merged;
  }

  String preferenceKey(Actor a, String page) {
    if (!page.matches("[a-z]{1,20}")) throw ApiException.bad("视图键无效。");
    return "view_" + a.id() + "_" + page;
  }
}

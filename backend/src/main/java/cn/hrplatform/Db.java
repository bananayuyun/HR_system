package cn.hrplatform;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Component;

@Component
public class Db {
  final JdbcTemplate jdbc;
  final ObjectMapper json;

  public Db(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  public Map<String, Object> one(String sql, Object... args) {
    var rows = jdbc.queryForList(sql, args);
    return rows.isEmpty() ? null : rows.get(0);
  }

  public long insert(String table, Map<String, Object> values) {
    String cols = String.join(",", values.keySet());
    String placeholders = String.join(",", Collections.nCopies(values.size(), "?"));
    var holder = new GeneratedKeyHolder();
    jdbc.update(
        c -> {
          PreparedStatement p =
              c.prepareStatement(
                  "INSERT INTO " + table + " (" + cols + ") VALUES (" + placeholders + ")",
                  Statement.RETURN_GENERATED_KEYS);
          int i = 1;
          for (Object v : values.values()) p.setObject(i++, v);
          return p;
        },
        holder);
    return Objects.requireNonNull(holder.getKey()).longValue();
  }

  public int update(String table, Map<String, Object> values, long id) {
    var args = new ArrayList<>(values.values());
    args.add(id);
    return jdbc.update(
        "UPDATE "
            + table
            + " SET "
            + String.join(",", values.keySet().stream().map(k -> k + "=?").toList())
            + " WHERE id=?",
        args.toArray());
  }

  public String json(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid JSON", e);
    }
  }

  public Map<String, Object> object(Object value) {
    if (value == null) return new LinkedHashMap<>();
    if (value instanceof Map<?, ?> m) return new LinkedHashMap<>((Map<String, Object>) m);
    try {
      return json.readValue(
          value.toString(), new TypeReference<LinkedHashMap<String, Object>>() {});
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid stored JSON", e);
    }
  }

  public static String text(Object v) {
    return v == null ? "" : String.valueOf(v).trim();
  }

  public static String str(Map<String, Object> m, String k) {
    return text(m.get(k));
  }

  public static long num(Object n) {
    return n instanceof Number x ? x.longValue() : Long.parseLong(text(n));
  }

  public static Map<String, Object> map(Object... pairs) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) m.put(pairs[i].toString(), pairs[i + 1]);
    return m;
  }
}

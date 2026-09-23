package cn.hrplatform;

import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class Scope {
  private final Db db;
  private final Audit audit;

  Scope(Db db, Audit audit) {
    this.db = db;
    this.audit = audit;
  }

  public Set<Long> orgs(Actor actor) {
    if (actor.all())
      return new HashSet<>(db.jdbc.queryForList("SELECT id FROM org_department", Long.class));
    if (actor.orgId() == null) return Set.of();
    if ("SELF_ORG".equals(actor.dataScope())) return Set.of(actor.orgId());
    return new HashSet<>(
        db.jdbc.queryForList(
            "WITH RECURSIVE tree AS (SELECT id FROM org_department WHERE id=? UNION ALL SELECT o.id"
                + " FROM org_department o JOIN tree t ON o.parent_id=t.id) SELECT id FROM tree",
            Long.class,
            actor.orgId()));
  }

  public void check(Actor actor, long orgId) {
    if (!orgs(actor).contains(orgId)) {
      audit.denied(actor, "ORGANIZATION", orgId);
      throw new ApiException(403, "该记录不在当前账号的数据范围内。");
    }
  }

  public boolean within(long child, long parent) {
    return db.jdbc.queryForObject(
            "WITH RECURSIVE tree AS (SELECT id FROM org_department WHERE id=? UNION ALL SELECT o.id"
                + " FROM org_department o JOIN tree t ON o.parent_id=t.id) SELECT COUNT(*) FROM"
                + " tree WHERE id=?",
            Integer.class,
            parent,
            child)
        > 0;
  }

  public long top(long id) {
    Set<Long> seen = new HashSet<>();
    long current = id;
    while (seen.add(current)) {
      var r = db.one("SELECT parent_id FROM org_department WHERE id=?", current);
      if (r == null || r.get("parent_id") == null) return current;
      long p = Db.num(r.get("parent_id"));
      var parent = db.one("SELECT parent_id FROM org_department WHERE id=?", p);
      if (parent == null || parent.get("parent_id") == null) return current;
      current = p;
    }
    throw ApiException.conflict("组织树存在循环引用。");
  }
}

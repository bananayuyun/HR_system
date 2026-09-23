package cn.hrplatform;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Service
public class Audit {
  private final Db db;
  private final TransactionTemplate isolated;

  Audit(Db db, PlatformTransactionManager manager) {
    this.db = db;
    this.isolated = new TransactionTemplate(manager);
    this.isolated.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public void record(Actor a, String action, String type, Long id, Object before, Object after) {
    String ip = null, requestId = null;
    var attrs = RequestContextHolder.getRequestAttributes();
    if (attrs instanceof ServletRequestAttributes context) {
      var req = context.getRequest();
      ip = req.getRemoteAddr();
      requestId = Db.text(req.getAttribute("requestId"));
    }
    db.jdbc.update(
        "INSERT INTO"
            + " audit_log(actor_user_id,actor_role,action,resource_type,resource_id,before_json,after_json,ip,request_id)"
            + " VALUES(?,?,?,?,?,?,?,?,?)",
        a == null ? null : a.id(),
        a == null ? null : String.join(",", a.roles()),
        action,
        type,
        id,
        before == null ? null : db.json(before),
        after == null ? null : db.json(after),
        ip,
        requestId);
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void denied(Actor a, String type, Long id) {
    isolated.executeWithoutResult(s -> record(a, "ACCESS_DENIED", type, id, null, null));
  }

  public void require(Actor a, String permission) {
    if (!a.can(permission)) {
      denied(a, permission, null);
      throw new ApiException(403, "没有此操作权限。");
    }
  }
}

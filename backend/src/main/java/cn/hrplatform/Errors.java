package cn.hrplatform;

import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class Errors {
  private static final Logger log = LoggerFactory.getLogger(Errors.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<?> api(ApiException e) {
    return ResponseEntity.status(e.status)
        .body(Map.of("message", e.getMessage(), "code", e.status));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<?> constraint(DataIntegrityViolationException e) {
    return ResponseEntity.status(409)
        .body(Map.of("message", "数据重复或关联约束不满足，请检查编号、手机号与关联记录。", "code", 409));
  }

  @ExceptionHandler({
    IllegalArgumentException.class,
    java.time.DateTimeException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class
  })
  ResponseEntity<?> input(Exception e) {
    return ResponseEntity.badRequest().body(Map.of("message", "请求格式或字段值无效。", "code", 400));
  }

  @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
  ResponseEntity<?> large(Exception e) {
    return ResponseEntity.status(413).body(Map.of("message", "上传文件超过 20 MB 限制。", "code", 413));
  }

  @ExceptionHandler({
    org.springframework.web.servlet.NoHandlerFoundException.class,
    org.springframework.web.servlet.resource.NoResourceFoundException.class
  })
  ResponseEntity<?> notFound(Exception e) {
    return ResponseEntity.status(404).body(Map.of("message", "请求的接口或资源不存在。", "code", 404));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(Exception e) {
    String id = UUID.randomUUID().toString();
    log.error("Request failed {}", id, e);
    return ResponseEntity.internalServerError()
        .body(Map.of("message", "服务处理失败，请联系管理员并提供请求号。", "requestId", id, "code", 500));
  }
}

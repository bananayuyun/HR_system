package cn.hrplatform;

import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FilesService {
  final HrService hr;
  final Db db;
  final Path directory;

  FilesService(HrService hr, @Value("${hr.upload-directory}") String directory) {
    this.hr = hr;
    this.db = hr.database();
    this.directory = Paths.get(directory).toAbsolutePath().normalize();
  }

  @Transactional
  public Map<String, Object> upload(
      Actor a, String type, String code, MultipartFile file, String category) {
    allowed(type);
    hr.auditor().require(a, type.equals("emps") ? "emps:write" : "candidates:write");
    var row = hr.raw(a, type, code, false);
    if (file.isEmpty() || file.getSize() > 20L * 1024 * 1024)
      throw ApiException.bad("附件须为 1 字节至 20 MB。");
    String name =
        Path.of(Optional.ofNullable(file.getOriginalFilename()).orElse("附件"))
            .getFileName()
            .toString();
    String suffix = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase() : "";
    if (!Set.of(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp", ".txt")
        .contains(suffix)) throw ApiException.bad("附件格式须为 PDF、Office 文档、图片或 TXT。");
    String key = UUID.randomUUID() + suffix;
    Path target = directory.resolve(key).normalize();
    if (!target.startsWith(directory)) throw ApiException.bad("文件路径无效。");
    try {
      Files.createDirectories(directory);
      try (var in = file.getInputStream()) {
        Files.copy(in, target);
      }
    } catch (Exception e) {
      throw new IllegalStateException("Cannot store attachment", e);
    }
    if (org.springframework.transaction.support.TransactionSynchronizationManager
        .isSynchronizationActive())
      org.springframework.transaction.support.TransactionSynchronizationManager
          .registerSynchronization(
              new org.springframework.transaction.support.TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                  if (status != STATUS_COMMITTED)
                    try {
                      Files.deleteIfExists(target);
                    } catch (Exception ignored) {
                    }
                }
              });
    String table = type.equals("emps") ? "employee_file" : "candidate_file";
    Map<String, Object> values =
        Db.map(
            type.equals("emps") ? "employee_id" : "candidate_id",
            row.get("id"),
            "file_name",
            name,
            "object_key",
            key,
            "size_bytes",
            file.getSize(),
            "mime_type",
            file.getContentType(),
            "uploaded_by",
            a.id());
    if (type.equals("emps"))
      values.put("file_type", category == null || category.isBlank() ? "其它材料" : category);
    long id;
    try {
      id = db.insert(table, values);
    } catch (RuntimeException e) {
      try {
        Files.deleteIfExists(target);
      } catch (Exception ignored) {
      }
      throw e;
    }
    hr.auditor()
        .record(
            a,
            "FILE_UPLOAD",
            type,
            Db.num(row.get("id")),
            null,
            Db.map("fileId", id, "fileName", name));
    return Db.map(
        "id",
        id,
        "name",
        name,
        "size",
        file.getSize(),
        "category",
        category == null ? "" : category,
        "url",
        "/api/" + type + "/files/" + id,
        "previewUrl",
        "/api/" + type + "/files/" + id + "?inline=true");
  }

  Map<String, Object> file(Actor a, String type, long id) {
    allowed(type);
    String table = type.equals("emps") ? "employee_file" : "candidate_file";
    var f = db.one("SELECT * FROM " + table + " WHERE id=? AND status='ACTIVE'", id);
    if (f == null) throw new ApiException(404, "附件不存在。");
    String code = hr.code(type, f.get(type.equals("emps") ? "employee_id" : "candidate_id"));
    hr.raw(a, type, code, false);
    return f;
  }

  public ResponseEntity<?> download(Actor a, String type, long id, boolean inline) {
    if (type.equals("emps")) hr.auditor().require(a, "emps:sensitive");
    else hr.auditor().require(a, "pool:read");
    var f = file(a, type, id);
    Path path = directory.resolve(Db.str(f, "object_key")).normalize();
    if (!path.startsWith(directory) || !Files.isRegularFile(path))
      throw new ApiException(404, "附件文件不存在。");
    hr.auditor()
        .record(
            a,
            "FILE_DOWNLOAD",
            type,
            Db.num(f.get(type.equals("emps") ? "employee_id" : "candidate_id")),
            null,
            Db.map("fileId", id));
    String filename = Db.str(f, "file_name"),
        suffix =
            filename.contains(".")
                ? filename.substring(filename.lastIndexOf('.')).toLowerCase(Locale.ROOT)
                : "";
    String mime =
        Map.of(
                ".pdf",
                "application/pdf",
                ".png",
                "image/png",
                ".jpg",
                "image/jpeg",
                ".jpeg",
                "image/jpeg",
                ".webp",
                "image/webp")
            .get(suffix);
    boolean preview = inline && mime != null;
    return ResponseEntity.ok()
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            (preview ? ContentDisposition.inline() : ContentDisposition.attachment())
                .filename(filename, java.nio.charset.StandardCharsets.UTF_8)
                .build()
                .toString())
        .header("X-Frame-Options", preview ? "SAMEORIGIN" : "DENY")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .contentType(preview ? MediaType.parseMediaType(mime) : MediaType.APPLICATION_OCTET_STREAM)
        .body(new FileSystemResource(path));
  }

  @Transactional
  public void remove(Actor a, String type, long id) {
    hr.auditor().require(a, type.equals("emps") ? "emps:write" : "candidates:write");
    var f = file(a, type, id);
    db.jdbc.update(
        "UPDATE "
            + (type.equals("emps") ? "employee_file" : "candidate_file")
            + " SET status='DELETED' WHERE id=?",
        id);
    hr.auditor()
        .record(
            a,
            "FILE_ARCHIVE",
            type,
            Db.num(f.get(type.equals("emps") ? "employee_id" : "candidate_id")),
            null,
            Db.map("fileId", id));
  }

  void allowed(String type) {
    if (!Set.of("emps", "candidates").contains(type)) throw new ApiException(404, "此资源不支持附件。");
  }
}

package cn.hrplatform;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class ApiController {
  final Auth auth;
  final HrService hr;
  final WorkflowService workflows;
  final ImportService imports;
  final SettingsService settings;
  final FilesService files;
  final ResumeService resumes;

  ApiController(
      Auth auth,
      HrService hr,
      WorkflowService workflows,
      ImportService imports,
      SettingsService settings,
      FilesService files,
      ResumeService resumes) {
    this.auth = auth;
    this.hr = hr;
    this.workflows = workflows;
    this.imports = imports;
    this.settings = settings;
    this.files = files;
    this.resumes = resumes;
  }

  Actor actor(HttpServletRequest request) {
    return (Actor) request.getAttribute("actor");
  }

  @PostMapping("/auth/login")
  public Object login(HttpServletRequest req, @RequestBody Map<String, Object> body) {
    return auth.login(req, body);
  }

  @GetMapping({"/auth/me", "/me"})
  public Object me(HttpServletRequest req) {
    return Map.of("user", actor(req).view());
  }

  @PostMapping("/auth/logout")
  public Object logout(HttpServletRequest req) {
    hr.auditor().record(actor(req), "LOGOUT", "AUTH", actor(req).id(), null, null);
    if (req.getSession(false) != null) req.getSession(false).invalidate();
    return Map.of("success", true);
  }

  @PostMapping("/auth/password")
  public Object password(HttpServletRequest req, @RequestBody Map<String, Object> body) {
    auth.password(actor(req), body, req);
    return Map.of("success", true);
  }

  @GetMapping("/bootstrap")
  public Object bootstrap(HttpServletRequest req) {
    return hr.bootstrap(actor(req));
  }

  @GetMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}")
  public Object list(
      HttpServletRequest req,
      @PathVariable String type,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "50") int size,
      @RequestParam(defaultValue = "false") boolean archived,
      @RequestParam(defaultValue = "") String q) {
    size = Math.min(200, Math.max(1, size));
    page = Math.max(1, page);
    var list =
        (archived ? hr.archived(actor(req), type) : hr.list(actor(req), type, false))
            .stream()
                .filter(
                    r ->
                        q.isBlank() || Db.str(r, "name").contains(q) || Db.str(r, "id").contains(q))
                .toList();
    int start = (int) Math.min(list.size(), ((long) page - 1) * size),
        end = Math.min(list.size(), start + size);
    return Db.map(
        "items", list.subList(start, end), "total", list.size(), "page", page, "size", size);
  }

  @GetMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}/{id}")
  public Object detail(HttpServletRequest req, @PathVariable String type, @PathVariable String id) {
    return hr.get(actor(req), type, id);
  }

  @PostMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}")
  public Object create(
      HttpServletRequest req, @PathVariable String type, @RequestBody Map<String, Object> body) {
    return hr.save(actor(req), type, null, body);
  }

  @PutMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}/{id}")
  public Object update(
      HttpServletRequest req,
      @PathVariable String type,
      @PathVariable String id,
      @RequestBody Map<String, Object> body) {
    return hr.save(actor(req), type, id, body);
  }

  @DeleteMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}/{id}")
  public Object archive(
      HttpServletRequest req, @PathVariable String type, @PathVariable String id) {
    return hr.archive(actor(req), type, id, false);
  }

  @PostMapping("/{type:orgs|jobs|grades|emps|reqs|candidates|assets}/{id}/restore")
  public Object restore(
      HttpServletRequest req, @PathVariable String type, @PathVariable String id) {
    return hr.archive(actor(req), type, id, true);
  }

  @PostMapping("/orgs/{id}/move")
  public Object moveOrg(HttpServletRequest req, @PathVariable String id,
      @RequestBody Map<String, Object> body) {
    return hr.moveOrg(actor(req), id, Db.str(body, "direction"));
  }

  @DeleteMapping("/emps/{id}/permanent")
  public Object permanentlyDeleteEmployee(HttpServletRequest req, @PathVariable String id) {
    return hr.permanentlyDeleteEmployee(actor(req), id);
  }

  @PostMapping("/{type:emps|candidates|assets}/{id}/actions/{action}")
  public Object action(
      HttpServletRequest req,
      @PathVariable String type,
      @PathVariable String id,
      @PathVariable String action,
      @RequestBody Map<String, Object> body) {
    return workflows.action(actor(req), type, id, action, body);
  }

  @PostMapping("/candidates/{id}/screening")
  public Object screening(
      HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
    return workflows.action(actor(req), "candidates", id, "screening", body);
  }

  @PostMapping("/candidates/{id}/interviews")
  public Object schedule(
      HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
    return workflows.action(actor(req), "candidates", id, "schedule", body);
  }

  @PostMapping("/candidates/{id}/onboarding")
  public Object onboard(
      HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
    return workflows.action(actor(req), "candidates", id, "onboarding", body);
  }

  @PostMapping("/interviews/{interviewId}/result")
  public Object result(
      HttpServletRequest req,
      @PathVariable long interviewId,
      @RequestBody Map<String, Object> body) {
    var row =
        hr.database()
            .one(
                "SELECT c.code FROM candidate c JOIN interview i ON i.candidate_id=c.id WHERE"
                    + " i.id=?",
                interviewId);
    if (row == null) throw new ApiException(404, "面试不存在。");
    var input = new LinkedHashMap<>(body);
    input.put("interviewId", interviewId);
    return workflows.action(
        actor(req), "candidates", Db.str(row, "code"), "interview-result", input);
  }

  @PostMapping("/assets/{id}/actions")
  public Object assetAction(
      HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
    String action = Db.str(body, "action").toLowerCase(Locale.ROOT).replace('_', '-');
    return workflows.action(actor(req), "assets", id, action, body);
  }

  @PostMapping("/emps/{id}/timeline")
  public Object timeline(
      HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
    return workflows.action(actor(req), "emps", id, "timeline", body);
  }

  @GetMapping("/emps/{id}/sensitive")
  public Object sensitive(HttpServletRequest req, @PathVariable String id) {
    return hr.sensitive(actor(req), id);
  }

  @GetMapping("/{type:emps|candidates|assets|reqs|orgs|jobs|grades}/{id}/audit")
  public Object audit(HttpServletRequest req, @PathVariable String type, @PathVariable String id) {
    hr.auditor().require(actor(req), "audit:read");
    var entity = hr.raw(actor(req), type, id, false);
    return hr.auditEntries(type, Db.num(entity.get("id")));
  }

  @PostMapping("/imports/{type}")
  public Object importRows(
      HttpServletRequest req, @PathVariable String type, @RequestBody Map<String, Object> body) {
    return imports.run(actor(req), type, body);
  }

  @GetMapping("/imports/{type}/logs")
  public Object importLogs(
      HttpServletRequest req,
      @PathVariable String type,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "20") int size) {
    return imports.logs(actor(req), type, page, size);
  }

  @GetMapping("/imports/{type}/logs/{id}")
  public Object importLog(
      HttpServletRequest req, @PathVariable String type, @PathVariable long id) {
    return imports.log(actor(req), type, id);
  }

  @PostMapping("/candidates/actions/batch-screening")
  public Object batchScreening(HttpServletRequest req, @RequestBody Map<String, Object> body) {
    return workflows.batchScreening(actor(req), body);
  }

  @PostMapping(value = "/imports/{type}/parse", consumes = "multipart/form-data")
  public Object parse(
      HttpServletRequest req, @PathVariable String type, @RequestParam MultipartFile file) {
    return imports.parse(actor(req), type, file);
  }

  @GetMapping("/settings/{key}")
  public Object setting(HttpServletRequest req, @PathVariable String key) {
    return settings.get(actor(req), key);
  }

  @PutMapping("/settings/{key}")
  public Object settingPut(
      HttpServletRequest req, @PathVariable String key, @RequestBody Map<String, Object> body) {
    return settings.put(actor(req), key, body);
  }

  @DeleteMapping("/settings/{key}/{itemId}")
  public Object settingDelete(
      HttpServletRequest req, @PathVariable String key, @PathVariable long itemId) {
    settings.delete(actor(req), key, itemId);
    return Map.of("success", true);
  }

  @PostMapping("/audit/export")
  public Object export(HttpServletRequest req, @RequestBody Map<String, Object> body) {
    settings.export(actor(req), body);
    return Map.of("success", true);
  }

  @GetMapping("/preferences/{page}")
  public Object preferences(HttpServletRequest req, @PathVariable String page) {
    return settings.preferences(actor(req), page);
  }

  @PutMapping("/preferences/{page}")
  public Object preferencePut(
      HttpServletRequest req, @PathVariable String page, @RequestBody Map<String, Object> body) {
    return settings.preferences(actor(req), page, body);
  }

  @PostMapping(value = "/{type:emps|candidates}/{id}/files", consumes = "multipart/form-data")
  public Object upload(
      HttpServletRequest req,
      @PathVariable String type,
      @PathVariable String id,
      @RequestParam MultipartFile file,
      @RequestParam(defaultValue = "其它材料") String category) {
    return files.upload(actor(req), type, id, file, category);
  }

  @GetMapping("/{type:emps|candidates}/files/{fileId}")
  public ResponseEntity<?> download(
      HttpServletRequest req,
      @PathVariable String type,
      @PathVariable long fileId,
      @RequestParam(defaultValue = "false") boolean inline) {
    return files.download(actor(req), type, fileId, inline);
  }

  @DeleteMapping("/{type:emps|candidates}/files/{fileId}")
  public Object deleteFile(
      HttpServletRequest req, @PathVariable String type, @PathVariable long fileId) {
    files.remove(actor(req), type, fileId);
    return Map.of("success", true);
  }

  @PostMapping(value = "/resumes/parse", consumes = "multipart/form-data")
  public Object parseResume(HttpServletRequest req, @RequestParam MultipartFile file) {
    return resumes.parse(actor(req), file);
  }

  @PostMapping(value = "/resumes", consumes = "multipart/form-data")
  public Object createResume(
      HttpServletRequest req, @RequestParam MultipartFile file, @RequestParam String data) {
    return resumes.create(actor(req), data, file);
  }
}

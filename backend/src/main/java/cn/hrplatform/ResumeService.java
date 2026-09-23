package cn.hrplatform;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ResumeService {
  final HrService hr;
  final FilesService files;

  ResumeService(HrService hr, FilesService files) {
    this.hr = hr;
    this.files = files;
  }

  public Map<String, Object> parse(Actor a, MultipartFile file) {
    hr.auditor().require(a, "candidates:write");
    if (file.isEmpty() || file.getSize() > 20L * 1024 * 1024)
      throw ApiException.bad("简历大小须为 1 字节至 20 MB。");
    String name =
        Optional.ofNullable(file.getOriginalFilename()).orElse("").toLowerCase(Locale.ROOT);
    String raw = "", issue = "";
    try {
      if (name.endsWith(".pdf")) {
        try (var doc = Loader.loadPDF(file.getBytes())) {
          if (doc.getNumberOfPages() > 100) throw ApiException.bad("简历最多 100 页。");
          raw = new PDFTextStripper().getText(doc);
        }
      } else if (name.endsWith(".docx")) {
        try (var doc = new XWPFDocument(file.getInputStream());
            var reader = new XWPFWordExtractor(doc)) {
          raw = reader.getText();
        }
      } else if (name.endsWith(".doc")) {
        try (var doc = new HWPFDocument(file.getInputStream());
            var reader = new WordExtractor(doc)) {
          raw = reader.getText();
        }
      } else if (name.endsWith(".txt")) raw = new String(file.getBytes(), StandardCharsets.UTF_8);
      else issue = "此格式不支持文本解析，请手工核对姓名和手机号，确认后原文件会保存。";
    } catch (Exception e) {
      issue = "简历文本解析失败，请手工填写。原文件可随录入保存。";
    }
    if (raw.length() > 20000) raw = raw.substring(0, 20000);
    if (raw.isBlank() && issue.isBlank()) issue = "未提取到文本，文件可能为扫描件；请手工核对姓名和手机号。";
    String
        person =
            find("(?:姓名|Name)\\s*[:：]?\\s*([\\p{IsHan}]{2,8}|[A-Za-z]+(?: [A-Za-z]+){0,2})", raw),
        phone = find("(?<!\\d)(1\\d{10})(?!\\d)", raw),
        email = find("([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})", raw);
    return Db.map(
        "name",
        person,
        "phone",
        phone,
        "email",
        email,
        "raw",
        raw,
        "issue",
        issue,
        "parsed",
        !raw.isBlank());
  }

  String find(String pattern, String raw) {
    var match = Pattern.compile(pattern, Pattern.CASE_INSENSITIVE).matcher(raw);
    return match.find() ? match.group(1) : "";
  }

  @Transactional
  public Map<String, Object> create(Actor a, String data, MultipartFile file) {
    var body = hr.database().object(data);
    HrService.requireText(body, "workRegion");
    HrService.requireText(body, "workplace");
    var candidate = hr.saveInternal(a, "candidates", null, body, false);
    files.upload(a, "candidates", Db.str(candidate, "id"), file, "简历");
    return hr.get(a, "candidates", Db.str(candidate, "id"));
  }
}

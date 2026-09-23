import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.WorkbookFactory;

/** Test-only format fixtures. Compiled outside backend/target; no application classes are used. */
public class LegacyFormatFixture {
  public static void main(String[] args) throws Exception {
    Path output = Path.of(args[0]).toAbsolutePath().normalize();
    String prefix = args[1];
    if (!prefix.matches("FIXQAFORMAT[A-Z0-9]+"))
      throw new IllegalArgumentException("Bad fixture prefix");
    Files.createDirectories(output);
    Path xls = output.resolve(prefix + ".xls"), pdf = output.resolve(prefix + ".pdf");
    List<String> headers = List.of("工号", "姓名", "入职日期", "档案编号", "备注");
    List<List<String>> expected =
        List.of(
            List.of("0000123", "格式测试甲", "2026-09-18", "000007", "中文与前导零"),
            List.of(),
            List.of("0000456", "格式测试乙", "2024-02-29", "000042", "闰日测试"));
    try (var workbook = new HSSFWorkbook()) {
      Sheet sheet = workbook.createSheet("花名册兼容");
      sheet.setDisplayGridlines(false);
      sheet.createFreezePane(0, 2);
      var font = workbook.createFont();
      font.setFontName("Microsoft YaHei");
      font.setFontHeightInPoints((short) 11);
      var headerFont = workbook.createFont();
      headerFont.setFontName("Microsoft YaHei");
      headerFont.setFontHeightInPoints((short) 11);
      headerFont.setBold(true);
      headerFont.setColor(IndexedColors.WHITE.getIndex());
      CellStyle headerStyle = workbook.createCellStyle();
      headerStyle.setFont(headerFont);
      headerStyle.setFillForegroundColor(IndexedColors.DARK_BLUE.getIndex());
      headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
      CellStyle ordinary = workbook.createCellStyle();
      ordinary.setFont(font);
      CellStyle date = workbook.createCellStyle();
      date.cloneStyleFrom(ordinary);
      date.setDataFormat(workbook.createDataFormat().getFormat("yyyy-mm-dd"));
      CellStyle padded = workbook.createCellStyle();
      padded.cloneStyleFrom(ordinary);
      padded.setDataFormat(workbook.createDataFormat().getFormat("000000"));
      Row header = sheet.createRow(1); // An intentionally empty leading row tests headerRow.
      header.setHeightInPoints(24);
      for (int c = 0; c < headers.size(); c++) {
        var cell = header.createCell(c);
        cell.setCellValue(headers.get(c));
        cell.setCellStyle(headerStyle);
        sheet.setColumnWidth(c, (c == 4 ? 24 : 20) * 256);
      }
      for (int n = 0; n < expected.size(); n++) {
        var values = expected.get(n);
        if (values.isEmpty()) continue; // Missing physical row tests original line preservation.
        Row row = sheet.createRow(n + 2);
        row.setHeightInPoints(24);
        for (int c = 0; c < values.size(); c++) {
          var cell = row.createCell(c);
          cell.setCellStyle(ordinary);
          if (c == 2) {
            cell.setCellValue(LocalDate.parse(values.get(c)));
            cell.setCellStyle(date);
          } else if (c == 3) {
            cell.setCellValue(Integer.parseInt(values.get(c)));
            cell.setCellStyle(padded);
          } else cell.setCellValue(values.get(c));
        }
      }
      try (OutputStream stream = Files.newOutputStream(xls)) {
        workbook.write(stream);
      }
    }
    List<List<String>> readback = new ArrayList<>();
    try (var workbook = WorkbookFactory.create(xls.toFile())) {
      if (!(workbook instanceof HSSFWorkbook)) throw new IllegalStateException("Not BIFF XLS");
      var formatter = new DataFormatter(Locale.ROOT);
      var sheet = workbook.getSheetAt(0);
      for (int r = 2; r <= sheet.getLastRowNum(); r++) {
        Row row = sheet.getRow(r);
        if (row == null) {
          readback.add(List.of());
          continue;
        }
        List<String> values = new ArrayList<>();
        for (int c = 0; c < headers.size(); c++)
          values.add(formatter.formatCellValue(row.getCell(c)));
        readback.add(values);
      }
      if (!expected.equals(readback)) throw new IllegalStateException("XLS readback differs");
    }
    renderTable(output.resolve("xls-preview.png"), headers, readback);
    String person = "Format Test", phone = "13900001234", email = "fixqa.format@example.test";
    try (var document = new PDDocument()) {
      var page = new PDPage();
      document.addPage(page);
      document.getDocumentInformation().setTitle(prefix + " Resume");
      try (var stream = new PDPageContentStream(document, page)) {
        stream.beginText();
        stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 14);
        stream.setLeading(25);
        stream.newLineAtOffset(50, 730);
        for (String line :
            List.of(
                "Name: " + person,
                "Phone: " + phone,
                "Email: " + email,
                "Fixture: " + prefix,
                "Experience: Java and MySQL development.")) {
          stream.showText(line);
          stream.newLine();
        }
        stream.endText();
      }
      document.save(pdf.toFile());
    }
    String text;
    try (var document = Loader.loadPDF(pdf.toFile())) {
      text = new PDFTextStripper().getText(document);
      if (!text.contains(phone) || !text.contains(email))
        throw new IllegalStateException("PDF has no expected text");
      ImageIO.write(
          new PDFRenderer(document).renderImageWithDPI(0, 100),
          "PNG",
          output.resolve("pdf-preview.png").toFile());
    }
    Map<String, Object> manifest = new LinkedHashMap<>();
    manifest.put("prefix", prefix);
    manifest.put(
        "xls",
        Map.of(
            "path",
            xls.toString(),
            "format",
            "BIFF8",
            "sheetName",
            "花名册兼容",
            "headerRow",
            2,
            "headers",
            headers,
            "rows",
            expected));
    manifest.put(
        "pdf",
        Map.of(
            "path",
            pdf.toString(),
            "pages",
            1,
            "name",
            person,
            "phone",
            phone,
            "email",
            email,
            "text",
            text));
    new ObjectMapper()
        .writerWithDefaultPrettyPrinter()
        .writeValue(output.resolve("fixture-manifest.json").toFile(), manifest);
    System.out.println(output.resolve("fixture-manifest.json"));
  }

  private static void renderTable(Path path, List<String> headers, List<List<String>> rows)
      throws Exception {
    int[] widths = {130, 150, 150, 130, 230};
    BufferedImage image = new BufferedImage(830, 210, BufferedImage.TYPE_INT_RGB);
    Graphics2D graphics = image.createGraphics();
    graphics.setColor(Color.WHITE);
    graphics.fillRect(0, 0, 830, 210);
    graphics.setFont(new Font("Microsoft YaHei", Font.PLAIN, 16));
    int x = 20;
    for (int c = 0; c < headers.size(); c++) {
      graphics.setColor(new Color(24, 49, 78));
      graphics.fillRect(x, 20, widths[c], 38);
      graphics.setColor(Color.WHITE);
      graphics.drawString(headers.get(c), x + 9, 46);
      x += widths[c];
    }
    for (int r = 0; r < rows.size(); r++) {
      x = 20;
      for (int c = 0; c < rows.get(r).size(); c++) {
        graphics.setColor(Color.DARK_GRAY);
        graphics.drawString(rows.get(r).get(c), x + 9, 82 + r * 40);
        x += widths[c];
      }
    }
    graphics.dispose();
    ImageIO.write(image, "PNG", path.toFile());
  }
}

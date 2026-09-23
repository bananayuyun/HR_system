import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;

/** Read-only inspection of a public Apache POI binary Word fixture. */
public class LegacyDocInspector {
  public static void main(String[] args) throws Exception {
    try (var input = Files.newInputStream(Path.of(args[0]));
        var document = new HWPFDocument(input);
        var extractor = new WordExtractor(document)) {
      System.out.println(
          new ObjectMapper()
              .writeValueAsString(
                  Map.of("format", "Word binary OLE2", "text", extractor.getText())));
    }
  }
}

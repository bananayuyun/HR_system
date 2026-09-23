const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200000;

// Only the main document is read. Images, links, macros and embedded objects are never executed.
export async function readDocxText(blob, signal) {
  if (!blob.size || blob.size > MAX_ARCHIVE_BYTES)
    throw new Error('Word 文件大小须为 1 字节至 20 MB。');
  const { Unzip, UnzipInflate } = await import('fflate');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  let size = 0,
    entries = 0,
    found = false,
    completed = false;
  const unzip = new Unzip((file) => {
    if (++entries > 2000) throw new Error('Word 内部文件过多，请下载查看。');
    if (file.name !== 'word/document.xml') return;
    if (found) throw new Error('Word 主文档重复，无法预览。');
    found = true;
    if (file.originalSize > MAX_DOCUMENT_BYTES) throw new Error('Word 文本过大，请下载查看。');
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      if (size > MAX_DOCUMENT_BYTES) throw new Error('Word 文本过大，请下载查看。');
      parts.push(chunk);
      completed = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks also bound allocation for an archive that lies about its size.
  for (let offset = 0; offset < bytes.length && !completed; offset += 2048) {
    signal?.throwIfAborted();
    unzip.push(bytes.subarray(offset, offset + 2048), offset + 2048 >= bytes.length);
    if (offset && offset % 131072 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  if (!found || !completed) throw new Error('未找到可预览的 Word 正文，请下载原文件查看。');
  const documentBytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    documentBytes.set(part, offset);
    offset += part.length;
  }
  const xml = new TextDecoder().decode(documentBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('此 Word 文件包含不受支持的 XML 声明。');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Word 正文损坏，无法预览。');
  const lines = [];
  let length = 0;
  for (const paragraph of doc.getElementsByTagNameNS('*', 'p')) {
    let line = '';
    for (const node of paragraph.getElementsByTagNameNS('*', '*')) {
      if (node.localName === 't') line += node.textContent;
      else if (node.localName === 'tab') line += '\t';
      else if (node.localName === 'br' || node.localName === 'cr') line += '\n';
    }
    lines.push(line);
    length += line.length + 1;
    if (length > MAX_TEXT_LENGTH) break;
  }
  const text = lines.join('\n').trim();
  if (!text) throw new Error('未提取到可用文字；扫描件或纯图片文档请下载查看。');
  return { text: text.slice(0, MAX_TEXT_LENGTH), truncated: text.length > MAX_TEXT_LENGTH };
}

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { HttpError, badRequest, notFound } from "./errors.js";

const IMAGE_TYPES = Object.freeze({
  "image/png": { extension: ".png", matches: isPng },
  "image/jpeg": { extension: ".jpg", matches: isJpeg },
  "image/webp": { extension: ".webp", matches: isWebp },
});
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const OFFICE_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties", ".env", ".sql",
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".svg", ".rtf",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".java", ".kt", ".kts", ".go", ".rs",
  ".py", ".pyi", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".php",
  ".rb", ".swift", ".scala", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".pl", ".pm", ".lua", ".r", ".dart", ".ex", ".exs", ".erl", ".hrl", ".fs", ".fsx",
  ".gradle", ".groovy", ".make", ".mk", ".cmake", ".dockerfile", ".gitignore", ".gitattributes",
]);
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/sql",
  "application/rtf",
  "application/x-httpd-php",
  "application/x-sh",
  "image/svg+xml",
]);
const ARCHIVE_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
]);
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".dll", ".msi", ".msp", ".msix", ".appx", ".com", ".scr", ".cpl", ".sys",
  ".lnk", ".url", ".reg", ".chm", ".iso", ".img", ".vhd", ".vhdx",
]);
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ZIP_MAGIC = Buffer.from("504b", "hex");
const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_OFFICE_MEMBER_BYTES = 8 * 1024 * 1024;

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isWebp(buffer) {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function hasExecutableMagic(buffer) {
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "MZ") return true;
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from("7f454c46", "hex"))) return true;
  if (buffer.length < 4) return false;
  const magic = buffer.readUInt32BE(0);
  return new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]).has(magic);
}

function safeFileName(value, fallback = "attachment.bin") {
  const raw = typeof value === "string" ? path.basename(value.trim()) : "";
  let name = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180)
    .trim();
  if (!name) name = fallback;
  if (WINDOWS_RESERVED_NAMES.test(name)) name = `_${name}`;
  return name;
}

function normalizedMimeType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase() || "application/octet-stream";
}

function fallbackImageName(buffer, declaredMimeType) {
  const matched = Object.entries(IMAGE_TYPES).find(([, definition]) => definition.matches(buffer));
  if (matched) return `image${matched[1].extension}`;
  const declared = IMAGE_TYPES[declaredMimeType];
  return declared ? `image${declared.extension}` : "image.bin";
}

function inferredMimeType(extension, declared) {
  if (IMAGE_EXTENSIONS.has(extension)) {
    if (extension === ".png") return "image/png";
    if (extension === ".webp") return "image/webp";
    return "image/jpeg";
  }
  const known = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".rtf": "application/rtf",
    ".json": "application/json",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".zip": "application/zip",
  };
  return known[extension] ?? declared;
}

function classifyAttachment(buffer, name, declaredMimeType, imageOnly = false) {
  const extension = path.extname(name).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(extension) || hasExecutableMagic(buffer)) {
    throw new HttpError(415, "EXECUTABLE_FILE_FORBIDDEN", "Executable files, installers, shortcuts, and disk images are not accepted.");
  }

  const imageDefinition = Object.entries(IMAGE_TYPES)
    .find(([, definition]) => definition.matches(buffer));
  if (imageDefinition) {
    const [mimeType] = imageDefinition;
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new HttpError(415, "IMAGE_EXTENSION_MISMATCH", "The image filename extension does not match its content.");
    }
    return { kind: "image", extension, mimeType };
  }
  if (imageOnly) {
    throw new HttpError(415, "INVALID_IMAGE_CONTENT", "Only valid PNG, JPEG, and WebP images are supported by this endpoint.");
  }
  if (IMAGE_EXTENSIONS.has(extension) || declaredMimeType.startsWith("image/")) {
    throw new HttpError(415, "INVALID_IMAGE_CONTENT", "The uploaded bytes do not match the declared image type.");
  }

  if (buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    if (!PDF_EXTENSIONS.has(extension)) {
      throw new HttpError(415, "PDF_EXTENSION_MISMATCH", "A PDF document must use the .pdf filename extension.");
    }
    return { kind: "pdf", extension, mimeType: "application/pdf" };
  }
  if (PDF_EXTENSIONS.has(extension) || declaredMimeType === "application/pdf") {
    throw new HttpError(415, "INVALID_PDF_CONTENT", "The uploaded bytes are not a valid PDF header.");
  }

  const zipContainer = buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
  if (OFFICE_EXTENSIONS.has(extension)) {
    if (!zipContainer) {
      throw new HttpError(415, "INVALID_OFFICE_CONTENT", "The Office/OpenDocument file is not a valid ZIP-based document.");
    }
    return { kind: "office", extension, mimeType: inferredMimeType(extension, declaredMimeType) };
  }

  if (TEXT_EXTENSIONS.has(extension) || declaredMimeType.startsWith("text/") || TEXT_MIME_TYPES.has(declaredMimeType)) {
    if (looksBinary(buffer)) {
      throw new HttpError(415, "INVALID_TEXT_CONTENT", "The uploaded text or source file appears to contain binary data.");
    }
    return { kind: extension === ".rtf" ? "rtf" : "text", extension, mimeType: inferredMimeType(extension, declaredMimeType) };
  }

  if (ARCHIVE_EXTENSIONS.has(extension) || zipContainer) {
    return { kind: "archive", extension, mimeType: inferredMimeType(extension, declaredMimeType) };
  }
  return { kind: "binary", extension, mimeType: inferredMimeType(extension, declaredMimeType) };
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 16_384));
  if (!sample.length) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.02;
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlToText(xml) {
  return decodeXmlEntities(String(xml)
    .replace(/<(?:w:tab|text:tab)\b[^>]*\/?>/gi, "\t")
    .replace(/<(?:w:br|a:br|text:line-break)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(?:w:p|a:p|text:p|text:h|table:table-row)>/gi, "\n")
    .replace(/<\/(?:w:tc|a:tc|table:table-cell)>/gi, "\t")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function naturalKey(value) {
  return String(value).replace(/\d+/g, (number) => number.padStart(12, "0"));
}

function unzipOffice(buffer) {
  let total = 0;
  try {
    return unzipSync(new Uint8Array(buffer), {
      filter(file) {
        const size = Number(file.originalSize) || 0;
        if (size > MAX_OFFICE_MEMBER_BYTES) return false;
        total += size;
        return total <= MAX_OFFICE_UNCOMPRESSED_BYTES;
      },
    });
  } catch {
    throw new HttpError(415, "INVALID_OFFICE_CONTENT", "The Office/OpenDocument archive could not be read.");
  }
}

function zipEntryText(entries, name) {
  const value = entries[name];
  return value ? strFromU8(value) : "";
}

function extractDocx(entries) {
  const names = Object.keys(entries)
    .filter((name) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i.test(name))
    .sort((left, right) => naturalKey(left).localeCompare(naturalKey(right)));
  return names.map((name) => xmlToText(zipEntryText(entries, name))).filter(Boolean).join("\n\n");
}

function extractPptx(entries) {
  const names = Object.keys(entries)
    .filter((name) => /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(name))
    .sort((left, right) => naturalKey(left).localeCompare(naturalKey(right)));
  return names.map((name) => {
    const label = name.includes("notesSlides") ? "Notes" : `Slide ${name.match(/(\d+)/)?.[1] ?? ""}`.trim();
    const text = xmlToText(zipEntryText(entries, name));
    return text ? `## ${label}\n${text}` : "";
  }).filter(Boolean).join("\n\n");
}

function sharedStringsFromXlsx(entries) {
  const xml = zipEntryText(entries, "xl/sharedStrings.xml");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlToText(match[1]));
}

function extractXlsx(entries) {
  const sharedStrings = sharedStringsFromXlsx(entries);
  const names = Object.keys(entries)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => naturalKey(left).localeCompare(naturalKey(right)));
  return names.map((name) => {
    const xml = zipEntryText(entries, name);
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
      const cells = [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)].map((cellMatch) => {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/i.exec(body)?.[1];
        if (inline) return xmlToText(inline);
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "";
        if (/\bt\s*=\s*["']s["']/i.test(attributes)) return sharedStrings[Number(raw)] ?? raw;
        return decodeXmlEntities(raw);
      });
      return cells.join("\t").replace(/\t+$/g, "");
    }).filter(Boolean);
    const sheetNumber = name.match(/(\d+)/)?.[1] ?? "";
    return rows.length ? `## Sheet ${sheetNumber}\n${rows.join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
}

function extractOpenDocument(entries) {
  return xmlToText(zipEntryText(entries, "content.xml"));
}

function extractRtf(buffer) {
  return decodeText(buffer)
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\u(-?\d+)\??/g, (_, number) => String.fromCodePoint(Number(number) < 0 ? Number(number) + 65_536 : Number(number)))
    .replace(/\\'[0-9a-f]{2}/gi, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(buffer) {
  let document;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      stopEventPropagation: true,
    });
    document = await loadingTask.promise;
    const sections = [];
    let length = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let line = "";
      for (const item of content.items) {
        if (typeof item?.str !== "string") continue;
        line += `${item.str}${item.hasEOL ? "\n" : " "}`;
      }
      const section = `## Page ${pageNumber}\n${line.replace(/[ \t]+\n/g, "\n").trim()}`;
      if (length + section.length > MAX_EXTRACTED_CHARACTERS) {
        truncated = true;
        break;
      }
      sections.push(section);
      length += section.length;
      page.cleanup?.();
    }
    return {
      text: sections.join("\n\n").trim(),
      details: { pageCount: document.numPages, truncated },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      throw new HttpError(422, "PDF_PASSWORD_REQUIRED", "Password-protected PDF files are not supported.");
    }
    throw new HttpError(422, "PDF_PROCESSING_FAILED", "The PDF could not be parsed.");
  } finally {
    await document?.destroy?.();
  }
}

async function extractedContent(buffer, classification) {
  if (classification.kind === "pdf") return extractPdf(buffer);
  if (classification.kind === "text") {
    return { text: decodeText(buffer).slice(0, MAX_EXTRACTED_CHARACTERS), details: {} };
  }
  if (classification.kind === "rtf") {
    return { text: extractRtf(buffer).slice(0, MAX_EXTRACTED_CHARACTERS), details: {} };
  }
  if (classification.kind !== "office") return { text: "", details: {} };
  const entries = unzipOffice(buffer);
  const extractors = {
    ".docx": extractDocx,
    ".pptx": extractPptx,
    ".xlsx": extractXlsx,
    ".odt": extractOpenDocument,
    ".ods": extractOpenDocument,
    ".odp": extractOpenDocument,
  };
  const text = (extractors[classification.extension]?.(entries) ?? "").slice(0, MAX_EXTRACTED_CHARACTERS);
  return { text, details: {} };
}

function publicAttachment(entry) {
  return {
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
    kind: entry.kind,
    textExtracted: Boolean(entry.extractedTextPath),
    extraction: { ...entry.extraction },
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

export class AttachmentUploadStore {
  constructor(options = {}) {
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 12;
    this.maxImages = options.maxImages ?? 4;
    this.maxTotalBytes = options.maxTotalBytes ?? 100 * 1024 * 1024;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1_000;
    this.maxPendingPerOwner = options.maxPendingPerOwner ?? this.maxFiles * 4;
    this.maxStored = options.maxStored ?? 512;
    this.baseRoot = path.resolve(options.root ?? path.join(os.tmpdir(), "codex-control-center-attachments"));
    this.sessionRoot = path.join(this.baseRoot, `session-${process.pid}-${randomUUID()}`);
    this.uploads = new Map();
    this.pendingWrites = new Map();
    this.closed = false;
    const cleanupIntervalMs = Math.min(Math.max(Math.floor(this.ttlMs / 2), 10_000), 60_000);
    this.cleanupTimer = setInterval(() => this.sweep(), cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  limits() {
    return {
      maxFiles: this.maxFiles,
      maxImages: this.maxImages,
      maxBytesPerFile: this.maxBytes,
      maxTotalBytes: this.maxTotalBytes,
      uploadTtlMs: this.ttlMs,
      maxPendingFilesPerOwner: this.maxPendingPerOwner,
      imageMimeTypes: Object.keys(IMAGE_TYPES),
      supportedDocuments: ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "rtf"],
      supportsTextAndSourceFiles: true,
      supportsArchives: true,
      rejectsExecutables: true,
    };
  }

  imageLimits() {
    return {
      maxImages: this.maxImages,
      maxBytesPerImage: this.maxBytes,
      supportedMimeTypes: Object.keys(IMAGE_TYPES),
      uploadTtlMs: this.ttlMs,
      maxPendingImagesPerOwner: this.maxPendingPerOwner,
    };
  }

  async create({ ownerId, body, mimeType, fileName, imageOnly = false }) {
    if (this.closed) throw new HttpError(503, "UPLOADS_UNAVAILABLE", "File uploads are unavailable while the server is shutting down.");
    if (typeof ownerId !== "string" || !ownerId) throw new HttpError(401, "UNAUTHORIZED", "An authenticated owner is required.");
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
    if (!buffer.length) throw badRequest("FILE_REQUIRED", "The file request body must not be empty.");
    if (buffer.length > this.maxBytes) {
      throw new HttpError(413, "FILE_TOO_LARGE", `Each file must be ${this.maxBytes} bytes or smaller.`);
    }
    const declaredMimeType = normalizedMimeType(mimeType);
    const name = safeFileName(
      fileName,
      imageOnly ? fallbackImageName(buffer, declaredMimeType) : "attachment.bin",
    );
    const classification = classifyAttachment(buffer, name, declaredMimeType, imageOnly);

    this.sweep();
    const pendingForOwner = this.pendingWrites.get(ownerId) ?? 0;
    const storedForOwner = [...this.uploads.values()]
      .filter((entry) => entry.ownerId === ownerId && !entry.claimed).length;
    if (storedForOwner + pendingForOwner >= this.maxPendingPerOwner) {
      throw new HttpError(429, "FILE_UPLOAD_LIMIT_REACHED", "Too many unused file uploads are pending for this caller.");
    }
    const totalPending = [...this.pendingWrites.values()].reduce((total, count) => total + count, 0);
    if (this.uploads.size + totalPending >= this.maxStored) {
      throw new HttpError(503, "FILE_UPLOAD_CAPACITY_REACHED", "The file upload store is temporarily full.");
    }

    const id = randomUUID();
    const directoryPath = path.join(this.sessionRoot, id);
    const filePath = path.join(directoryPath, name);
    this.pendingWrites.set(ownerId, pendingForOwner + 1);
    try {
      await mkdir(directoryPath, { recursive: true });
      await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
      const extraction = await extractedContent(buffer, classification);
      let extractedTextPath = null;
      if (extraction.text.trim()) {
        extractedTextPath = path.join(directoryPath, `${name}.codex-extracted.txt`);
        const header = [
          `Extracted content for Codex`,
          `Source file: ${name}`,
          `Source type: ${classification.kind}`,
          "",
        ].join("\n");
        await writeFile(extractedTextPath, `${header}${extraction.text}\n`, { flag: "wx", mode: 0o600 });
      }
      if (this.closed) {
        rmSync(directoryPath, { recursive: true, force: true });
        throw new HttpError(503, "UPLOADS_UNAVAILABLE", "File uploads are unavailable while the server is shutting down.");
      }
      const createdAt = new Date().toISOString();
      const entry = {
        id,
        ownerId,
        directoryPath,
        path: filePath,
        extractedTextPath,
        name,
        mimeType: classification.mimeType,
        size: buffer.length,
        kind: classification.kind,
        extraction: {
          available: Boolean(extractedTextPath),
          ...(extraction.details ?? {}),
        },
        createdAt,
        expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
        claimed: false,
      };
      this.uploads.set(id, entry);
      return publicAttachment(entry);
    } catch (error) {
      rmSync(directoryPath, { recursive: true, force: true });
      throw error;
    } finally {
      const remaining = (this.pendingWrites.get(ownerId) ?? 1) - 1;
      if (remaining > 0) this.pendingWrites.set(ownerId, remaining);
      else this.pendingWrites.delete(ownerId);
    }
  }

  claim(fileIds, ownerId) {
    if (fileIds === undefined) return [];
    if (!Array.isArray(fileIds)) throw badRequest("INVALID_FILE_IDS", "fileIds must be an array of uploaded file IDs.");
    if (fileIds.length > this.maxFiles) {
      throw badRequest("TOO_MANY_FILES", `A task can include at most ${this.maxFiles} files.`);
    }
    const ids = fileIds.map((value) => String(value ?? "").trim());
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) {
      throw badRequest("INVALID_FILE_IDS", "fileIds must contain unique valid upload IDs.");
    }
    this.sweep();
    const entries = ids.map((id) => {
      const entry = this.uploads.get(id);
      if (!entry || entry.ownerId !== ownerId || entry.claimed) throw notFound("Uploaded file not found.");
      return entry;
    });
    const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
    if (totalBytes > this.maxTotalBytes) {
      throw badRequest("ATTACHMENTS_TOO_LARGE", `The combined task attachments exceed ${this.maxTotalBytes} bytes.`);
    }
    if (entries.filter((entry) => entry.kind === "image").length > this.maxImages) {
      throw badRequest("TOO_MANY_IMAGES", `A task can include at most ${this.maxImages} images.`);
    }
    for (const entry of entries) entry.claimed = true;
    return entries.map((entry) => ({ ...entry, extraction: { ...entry.extraction } }));
  }

  discard(id, ownerId) {
    const entry = this.uploads.get(String(id));
    if (!entry || entry.ownerId !== ownerId || entry.claimed) throw notFound("Uploaded file not found.");
    this.#remove(entry);
    return { id: entry.id, deleted: true };
  }

  release(entries) {
    for (const candidate of entries ?? []) {
      const entry = this.uploads.get(candidate?.id);
      if (entry) this.#remove(entry);
    }
  }

  discardOwner(ownerId) {
    for (const entry of [...this.uploads.values()]) {
      if (entry.ownerId === ownerId && !entry.claimed) this.#remove(entry);
    }
  }

  sweep(nowMs = Date.now()) {
    for (const entry of [...this.uploads.values()]) {
      if (!entry.claimed && Date.parse(entry.expiresAt) <= nowMs) this.#remove(entry);
    }
  }

  #remove(entry) {
    this.uploads.delete(entry.id);
    rmSync(entry.directoryPath, { recursive: true, force: true });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.cleanupTimer);
    this.uploads.clear();
    this.pendingWrites.clear();
    rmSync(this.sessionRoot, { recursive: true, force: true });
  }
}

import { HttpError } from "./errors.js";

const DATA_URL_PREFIX = "data:";
const IMAGE_TYPES = Object.freeze({
  "image/png": { extension: ".png" },
  "image/jpeg": { extension: ".jpg" },
  "image/jpg": { extension: ".jpg", mimeType: "image/jpeg" },
  "image/webp": { extension: ".webp" },
});

function imageError(status, code, message, param) {
  return new HttpError(status, code, message, { param });
}

function withParam(error, param) {
  if (!(error instanceof HttpError)) return error;
  return new HttpError(error.status, error.code, error.message, {
    ...(error.details && typeof error.details === "object" ? error.details : {}),
    param,
  });
}

function decodedSize(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function decodeBase64(value, maxBytes, param) {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw imageError(400, "INVALID_IMAGE_DATA", "The image data URL contains invalid base64 data.", param);
  }
  if (decodedSize(value) > maxBytes) {
    throw imageError(413, "IMAGE_TOO_LARGE", `Each image must be ${maxBytes} bytes or smaller.`, param);
  }
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const buffer = Buffer.from(padded, "base64");
  if (!buffer.length
    || buffer.toString("base64").replace(/=+$/g, "") !== value.replace(/=+$/g, "")) {
    throw imageError(400, "INVALID_IMAGE_DATA", "The image data URL contains invalid base64 data.", param);
  }
  return buffer;
}

export function decodeOpenAIImageDataUrl(value, options = {}) {
  const param = options.param ?? null;
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : 25 * 1024 * 1024;
  if (typeof value !== "string" || !value.trim()) {
    throw imageError(400, "INVALID_IMAGE_URL", "image_url must be a non-empty string.", param);
  }
  const source = value.trim();
  if (!source.toLowerCase().startsWith(DATA_URL_PREFIX)) {
    throw imageError(
      400,
      "REMOTE_IMAGE_URL_UNSUPPORTED",
      "For security, image_url must be a base64 data URL using PNG, JPEG, or WebP data.",
      param,
    );
  }
  const comma = source.indexOf(",");
  if (comma < 0) {
    throw imageError(400, "INVALID_IMAGE_DATA_URL", "The image data URL is malformed.", param);
  }
  const metadata = source.slice(DATA_URL_PREFIX.length, comma).split(";");
  const declaredType = String(metadata.shift() ?? "").trim().toLowerCase();
  const definition = IMAGE_TYPES[declaredType];
  if (!definition) {
    throw imageError(
      415,
      "UNSUPPORTED_IMAGE_TYPE",
      "Only PNG, JPEG, and WebP image data URLs are supported.",
      param,
    );
  }
  if (!metadata.some((entry) => entry.trim().toLowerCase() === "base64")) {
    throw imageError(400, "INVALID_IMAGE_DATA_URL", "The image data URL must use base64 encoding.", param);
  }
  const mimeType = definition.mimeType ?? declaredType;
  const body = decodeBase64(source.slice(comma + 1), maxBytes, param);
  return {
    body,
    mimeType,
    fileName: `openai-image${definition.extension}`,
  };
}

export async function materializeOpenAIImages(inputs, options = {}) {
  const images = Array.isArray(inputs) ? inputs : [];
  if (!images.length) return { imageIds: [], discard() {} };
  const attachmentStore = options.attachmentStore;
  const ownerId = options.ownerId;
  if (!attachmentStore || typeof attachmentStore.create !== "function") {
    throw new HttpError(503, "IMAGE_UPLOADS_UNAVAILABLE", "Image inputs are unavailable for this Host.");
  }
  const imageLimits = attachmentStore.imageLimits();
  const fileLimits = attachmentStore.limits();
  if (images.length > imageLimits.maxImages) {
    throw imageError(
      400,
      "TOO_MANY_IMAGES",
      `A request can include at most ${imageLimits.maxImages} images.`,
      images[imageLimits.maxImages]?.param ?? "input",
    );
  }

  const createdIds = [];
  let totalBytes = 0;
  const discard = () => {
    for (const id of createdIds.splice(0)) {
      try {
        attachmentStore.discard(id, ownerId);
      } catch {
        // A claimed image is owned by the task and will be released with that task.
      }
    }
  };

  try {
    for (const image of images) {
      const decoded = decodeOpenAIImageDataUrl(image.source, {
        maxBytes: imageLimits.maxBytesPerImage,
        param: image.param,
      });
      totalBytes += decoded.body.length;
      if (totalBytes > fileLimits.maxTotalBytes) {
        throw imageError(
          413,
          "IMAGES_TOO_LARGE",
          `The combined images must be ${fileLimits.maxTotalBytes} bytes or smaller.`,
          image.param,
        );
      }
      try {
        const uploaded = await attachmentStore.create({
          ownerId,
          body: decoded.body,
          mimeType: decoded.mimeType,
          fileName: decoded.fileName,
          imageOnly: true,
        });
        createdIds.push(uploaded.id);
      } catch (error) {
        throw withParam(error, image.param);
      }
    }
    return { imageIds: [...createdIds], discard };
  } catch (error) {
    discard();
    throw error;
  }
}

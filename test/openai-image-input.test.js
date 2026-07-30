import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/server/errors.js";
import {
  decodeOpenAIImageDataUrl,
  materializeOpenAIImages,
} from "../src/server/openai-image-input.js";

const PNG_DATA = "data:image/png;base64,aGVsbG8=";

function expectImageError(action, code, status) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof HttpError, true);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test("OpenAI image data URLs normalize supported image types and padding", () => {
  const png = decodeOpenAIImageDataUrl(PNG_DATA, { param: "input[0]" });
  assert.equal(png.body.toString(), "hello");
  assert.equal(png.mimeType, "image/png");
  assert.equal(png.fileName, "openai-image.png");

  const jpegAlias = decodeOpenAIImageDataUrl(" DATA:image/jpg;charset=utf-8;BASE64,YQ== ");
  assert.equal(jpegAlias.body.toString(), "a");
  assert.equal(jpegAlias.mimeType, "image/jpeg");
  assert.equal(jpegAlias.fileName, "openai-image.jpg");

  assert.equal(decodeOpenAIImageDataUrl("data:image/webp;base64,YWI").body.toString(), "ab");
  assert.equal(decodeOpenAIImageDataUrl("data:image/jpeg;base64,YWJj").body.toString(), "abc");
});

test("OpenAI image data URLs reject malformed, remote, unsupported, and oversized input", () => {
  for (const value of [null, "", "   "]) {
    expectImageError(() => decodeOpenAIImageDataUrl(value), "INVALID_IMAGE_URL", 400);
  }
  expectImageError(() => decodeOpenAIImageDataUrl("https://example.com/image.png"), "REMOTE_IMAGE_URL_UNSUPPORTED", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png;base64"), "INVALID_IMAGE_DATA_URL", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/gif;base64,YQ=="), "UNSUPPORTED_IMAGE_TYPE", 415);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png,YQ=="), "INVALID_IMAGE_DATA_URL", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png;base64,"), "INVALID_IMAGE_DATA", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png;base64,%%%="), "INVALID_IMAGE_DATA", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png;base64,A"), "INVALID_IMAGE_DATA", 400);
  expectImageError(() => decodeOpenAIImageDataUrl("data:image/png;base64,AB=="), "INVALID_IMAGE_DATA", 400);
  expectImageError(() => decodeOpenAIImageDataUrl(PNG_DATA, { maxBytes: 4 }), "IMAGE_TOO_LARGE", 413);
});

test("materialized OpenAI images are owner-bound and can be discarded exactly once", async () => {
  const created = [];
  const discarded = [];
  const store = {
    imageLimits: () => ({ maxImages: 2, maxBytesPerImage: 10 }),
    limits: () => ({ maxTotalBytes: 10 }),
    async create(value) {
      created.push(value);
      return { id: `image-${created.length}` };
    },
    discard(id, ownerId) { discarded.push({ id, ownerId }); },
  };

  const none = await materializeOpenAIImages(null, { attachmentStore: store });
  assert.deepEqual(none.imageIds, []);
  none.discard();

  const result = await materializeOpenAIImages([
    { source: "data:image/png;base64,YQ==", param: "input[0]" },
    { source: "data:image/webp;base64,Yg==", param: "input[1]" },
  ], { attachmentStore: store, ownerId: "owner-a" });
  assert.deepEqual(result.imageIds, ["image-1", "image-2"]);
  assert.equal(created.every((entry) => entry.ownerId === "owner-a" && entry.imageOnly === true), true);
  result.discard();
  result.discard();
  assert.deepEqual(discarded, [
    { id: "image-1", ownerId: "owner-a" },
    { id: "image-2", ownerId: "owner-a" },
  ]);
});

test("materialization validates store availability and image count before writing", async () => {
  await assert.rejects(() => materializeOpenAIImages([{ source: PNG_DATA }]), { code: "IMAGE_UPLOADS_UNAVAILABLE" });
  await assert.rejects(() => materializeOpenAIImages([{ source: PNG_DATA }], { attachmentStore: {} }), {
    code: "IMAGE_UPLOADS_UNAVAILABLE",
  });

  const store = {
    imageLimits: () => ({ maxImages: 1, maxBytesPerImage: 20 }),
    limits: () => ({ maxTotalBytes: 20 }),
    create: async () => assert.fail("must validate before writing"),
  };
  await assert.rejects(() => materializeOpenAIImages([
    { source: PNG_DATA, param: "first" },
    { source: PNG_DATA, param: "second" },
  ], { attachmentStore: store }), (error) => error.code === "TOO_MANY_IMAGES" && error.details.param === "second");
});

test("materialization rolls back earlier uploads on total-size and upload errors", async () => {
  const discarded = [];
  const totalStore = {
    imageLimits: () => ({ maxImages: 3, maxBytesPerImage: 10 }),
    limits: () => ({ maxTotalBytes: 1 }),
    create: async () => ({ id: "first" }),
    discard(id) { discarded.push(id); },
  };
  await assert.rejects(() => materializeOpenAIImages([
    { source: "data:image/png;base64,YQ==", param: "first" },
    { source: "data:image/png;base64,Yg==", param: "second" },
  ], { attachmentStore: totalStore }), { code: "IMAGES_TOO_LARGE" });
  assert.deepEqual(discarded, ["first"]);

  let writes = 0;
  const uploadStore = {
    imageLimits: () => ({ maxImages: 3, maxBytesPerImage: 10 }),
    limits: () => ({ maxTotalBytes: 10 }),
    async create() {
      writes += 1;
      if (writes === 1) return { id: "created" };
      throw new HttpError(400, "UPLOAD_REJECTED", "rejected", { source: "store" });
    },
    discard(id) {
      discarded.push(id);
      if (id === "created") throw new Error("already claimed");
    },
  };
  await assert.rejects(() => materializeOpenAIImages([
    { source: "data:image/png;base64,YQ==", param: "first" },
    { source: "data:image/png;base64,Yg==", param: "second" },
  ], { attachmentStore: uploadStore }), (error) => {
    assert.equal(error.code, "UPLOAD_REJECTED");
    assert.deepEqual(error.details, { source: "store", param: "second" });
    return true;
  });
});

test("non-HTTP upload failures remain unchanged", async () => {
  const failure = new TypeError("storage offline");
  const store = {
    imageLimits: () => ({ maxImages: 1, maxBytesPerImage: 10 }),
    limits: () => ({ maxTotalBytes: 10 }),
    create: async () => { throw failure; },
    discard() {},
  };
  await assert.rejects(
    () => materializeOpenAIImages([{ source: "data:image/png;base64,YQ==", param: "image" }], { attachmentStore: store }),
    (error) => error === failure,
  );
});

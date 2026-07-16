import { AttachmentUploadStore } from "./attachment-upload-store.js";

// Backward-compatible export for integrations that imported the 0.4 image store.
export class ImageUploadStore extends AttachmentUploadStore {
  limits() {
    return this.imageLimits();
  }

  create(options) {
    return super.create({ ...options, imageOnly: true });
  }
}

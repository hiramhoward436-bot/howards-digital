/**
 * Storage abstraction for Project HD file uploads.
 *
 * Today the backend is D1 blobs (free tier, no payment method needed):
 * file metadata lives in the `files` table, bytes live in `file_contents`.
 *
 * A future S3-compatible backend (e.g. Gozunga Object Storage) can be added
 * here by implementing the same three methods and selecting it in
 * `getStorage()` when the corresponding env vars are present. No Gozunga
 * code, endpoints, or credentials exist in this project yet — that integration
 * has NOT been built or tested.
 *
 * Interface:
 *   put(fileId, data)    -> Promise<void>   store blob bytes
 *   get(fileId)          -> Promise<ArrayBuffer|null>
 *   delete(fileId)       -> Promise<void>   remove blob bytes
 */

export class D1BlobStorage {
  constructor(db) {
    this.db = db;
  }

  async put(fileId, data) {
    // Bind a Uint8Array view: some D1 drivers mishandle a raw ArrayBuffer
    // and store an empty blob.
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await this.db
      .prepare("INSERT INTO file_contents (file_id, data) VALUES (?, ?)")
      .bind(fileId, bytes)
      .run();
  }

  async get(fileId) {
    const row = await this.db
      .prepare("SELECT data FROM file_contents WHERE file_id = ?")
      .bind(fileId)
      .first();
    if (!row || !row.data) return null;
    // Real Workers D1 returns an ArrayBuffer; the local miniflare driver
    // returns a plain Array of byte values. Normalize to Uint8Array either way.
    if (Array.isArray(row.data)) return new Uint8Array(row.data);
    if (row.data instanceof ArrayBuffer) return new Uint8Array(row.data);
    if (row.data instanceof Uint8Array) return row.data;
    return null;
  }

  async delete(fileId) {
    // Explicit delete in addition to the ON DELETE CASCADE on files.file_id,
    // because D1 does not guarantee foreign-key enforcement on every path.
    await this.db
      .prepare("DELETE FROM file_contents WHERE file_id = ?")
      .bind(fileId)
      .run();
  }
}

/**
 * Pick the storage backend. Only the D1 backend is configured today.
 * To add an S3-compatible backend later, check for env vars such as
 * S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY here
 * and return an implementation with the same put/get/delete interface.
 */
export function getStorage(env) {
  return new D1BlobStorage(env.HD_DB);
}

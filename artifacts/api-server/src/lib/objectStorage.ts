import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { parseByteRange } from "./byteRange.js";

type ReadStreamOptions = { start?: number; end?: number };

type ObjectFileHandle = {
  download(): Promise<[Buffer]>;
  getMetadata(): Promise<{ contentType?: string | null; size?: string | number }>;
  createReadStream(options?: ReadStreamOptions): Promise<Readable>;
};

let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for object storage.");
    }
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

// The bucket names predate the Dreemer rename and are kept on purpose: live data lives in them.
function supabasePrivateBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || "glimpse";
}

function supabasePublicBucket(): string {
  return process.env.SUPABASE_PUBLIC_BUCKET || "glimpse-public";
}

export function mimeTypeFromObjectPath(objectPath: string): string {
  const lower = objectPath.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function assertNormalizedUploadObjectPath(objectPath: string): void {
  if (
    !/^\/objects\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(objectPath) ||
    objectPath.includes("..") ||
    objectPath.includes("\\") ||
    objectPath.includes("?") ||
    objectPath.includes("#")
  ) {
    throw new Error("Storage returned an invalid private upload object path.");
  }
}

function supabaseHandle(
  bucket: string,
  objectPath: string,
  contentType?: string | null,
  size?: string | number,
): ObjectFileHandle {
  return {
    download: async () => {
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(objectPath);
      if (error || !data) throw new ObjectNotFoundError();
      const buffer = Buffer.from(await data.arrayBuffer());
      return [buffer];
    },
    getMetadata: async () => ({
      contentType: contentType ?? mimeTypeFromObjectPath(objectPath),
      size,
    }),
    createReadStream: async (options) => {
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) throw new ObjectNotFoundError();

      const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
      const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`;
      const response = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          ...(options?.start != null
            ? { Range: `bytes=${options.start}-${options.end ?? ""}` }
            : {}),
        },
      });
      if (!response.ok || !response.body) {
        throw new ObjectNotFoundError();
      }
      if (options?.start != null && response.status !== 206) {
        const completeBuffer = Buffer.from(await response.arrayBuffer());
        return Readable.from(
          completeBuffer.subarray(options.start, (options.end ?? completeBuffer.length - 1) + 1),
        );
      }
      return Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    },
  };
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** Object storage on Supabase Storage: a private uploads bucket and a public bucket. */
export class ObjectStorageService {
  /**
   * Store a buffer as an unconditionally public object. Returns the path the
   * public-objects route serves it from (relative to /api/storage/public-objects/).
   * Used for outreach email imagery, which mail clients fetch anonymously.
   */
  async uploadPublicObject(relativePath: string, buffer: Buffer, contentType: string): Promise<string> {
    const cleanPath = relativePath.replace(/^\/+/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(cleanPath) || cleanPath.includes("..")) {
      throw new Error("Invalid public object path.");
    }
    const { error } = await getSupabaseAdmin()
      .storage.from(supabasePublicBucket())
      .upload(`public/${cleanPath}`, buffer, { contentType, upsert: true });
    if (error) {
      throw new Error(`Supabase public upload failed: ${error.message}`);
    }
    return cleanPath;
  }

  /**
   * Existence check for a public object. Uses a directory listing (metadata
   * only) rather than downloading the whole file: mail clients fetch outreach
   * images anonymously and a download-to-test-then-stream doubled the egress.
   */
  async searchPublicObject(filePath: string): Promise<ObjectFileHandle | null> {
    const bucket = supabasePublicBucket();
    const objectPath = `public/${filePath}`;
    const segments = objectPath.split("/");
    const fileName = segments.pop() ?? "";
    if (!fileName) return null;
    try {
      const { data: listed, error } = await getSupabaseAdmin()
        .storage.from(bucket)
        .list(segments.join("/"), { search: fileName, limit: 100 });
      if (error) return null;
      const meta = listed?.find((entry) => entry.name === fileName);
      if (!meta) return null;
      const m = (meta.metadata ?? {}) as Record<string, unknown>;
      const storedType = typeof m.mimetype === "string" ? m.mimetype : null;
      const storedSize = typeof m.size === "string" || typeof m.size === "number" ? m.size : undefined;
      return supabaseHandle(bucket, objectPath, storedType, storedSize);
    } catch {
      return null;
    }
  }

  async downloadObject(
    file: ObjectFileHandle,
    cacheTtlSec: number = 3600,
    objectPathHint?: string,
    rangeHeader?: string,
  ): Promise<Response> {
    const metadata = await file.getMetadata();

    const inferred =
      objectPathHint && metadata.contentType === "application/octet-stream"
        ? mimeTypeFromObjectPath(objectPathHint)
        : null;
    const contentType =
      (metadata.contentType as string) && metadata.contentType !== "application/octet-stream"
        ? (metadata.contentType as string)
        : inferred ?? (metadata.contentType as string) ?? "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
      "Accept-Ranges": "bytes",
    };

    let size = Number(metadata.size);
    let fallbackBuffer: Buffer | null = null;
    if (!Number.isSafeInteger(size) || size <= 0) {
      if (rangeHeader) {
        [fallbackBuffer] = await file.download();
        size = fallbackBuffer.length;
      } else {
        size = 0;
      }
    }

    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, size);
      if (!range) {
        headers["Content-Range"] = `bytes */${size}`;
        return new Response(null, { status: 416, headers });
      }

      const contentLength = range.end - range.start + 1;
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(contentLength);
      if (fallbackBuffer) {
        return new Response(fallbackBuffer.subarray(range.start, range.end + 1), {
          status: 206,
          headers,
        });
      }

      const rangeStream = await file.createReadStream(range);
      return new Response(Readable.toWeb(rangeStream) as ReadableStream, {
        status: 206,
        headers,
      });
    }

    const nodeStream = await file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    if (size > 0) headers["Content-Length"] = String(size);
    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(fileExtension = ""): Promise<string> {
    const objectId = randomUUID();
    const ext = fileExtension.startsWith(".") ? fileExtension : fileExtension ? `.${fileExtension}` : "";

    const { data, error } = await getSupabaseAdmin()
      .storage.from(supabasePrivateBucket())
      .createSignedUploadUrl(`uploads/${objectId}${ext}`);
    if (error || !data?.signedUrl) {
      throw new Error(`Supabase signed upload failed: ${error?.message ?? "unknown"}`);
    }
    return data.signedUrl;
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectFileHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    const bucket = supabasePrivateBucket();
    const storagePath = entityId.startsWith("uploads/") ? entityId : `uploads/${entityId}`;
    let storedType: string | null = null;
    let storedSize: string | number | undefined;
    try {
      const { data: listed, error } = await getSupabaseAdmin().storage.from(bucket).list(
        storagePath.includes("/") ? storagePath.split("/").slice(0, -1).join("/") : "",
        { search: storagePath.split("/").pop() },
      );
      if (error) throw error;
      const meta = listed?.find((f) => f.name === storagePath.split("/").pop());
      if (!meta) throw new ObjectNotFoundError();
      if (meta?.metadata && typeof meta.metadata === "object") {
        const m = meta.metadata as Record<string, unknown>;
        if (typeof m.mimetype === "string") storedType = m.mimetype;
        if (typeof m.size === "string" || typeof m.size === "number") storedSize = m.size;
      }
    } catch {
      throw new ObjectNotFoundError();
    }
    return supabaseHandle(bucket, storagePath, storedType, storedSize);
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!objectPath.startsWith("/objects/")) {
      return;
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      return;
    }

    const entityId = parts.slice(1).join("/");

    const storagePath = entityId.startsWith("uploads/") ? entityId : `uploads/${entityId}`;
    const { error } = await getSupabaseAdmin().storage.from(supabasePrivateBucket()).remove([storagePath]);
    if (error) {
      throw new Error(`Supabase object delete failed: ${error.message}`);
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) return rawPath;
    const uploadsMatch = rawPath.match(/uploads\/([^/?#]+)/);
    if (uploadsMatch) return `/objects/uploads/${uploadsMatch[1]}`;
    try {
      const url = new URL(rawPath);
      const pathMatch = url.pathname.match(/uploads\/([^/]+)/);
      if (pathMatch) return `/objects/uploads/${pathMatch[1]}`;
    } catch {
      /* not a URL */
    }
    return rawPath;
  }
}

import { Storage, File } from "@google-cloud/storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

export type ObjectFileHandle = {
  download(): Promise<[Buffer]>;
  getMetadata(): Promise<{ contentType?: string | null; size?: string | number }>;
  createReadStream(): Readable;
};

export const objectStorageClient = new Storage();

function useSupabaseStorage(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for Supabase storage.");
    }
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

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

function gcsHandle(file: File): ObjectFileHandle {
  return {
    download: () => file.download() as Promise<[Buffer]>,
    getMetadata: async () => {
      const [metadata] = await file.getMetadata();
      return metadata;
    },
    createReadStream: () => file.createReadStream(),
  };
}

function supabaseHandle(
  bucket: string,
  objectPath: string,
  contentType?: string | null,
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
    }),
    createReadStream: () => {
      const pass = new Readable({ read() {} });
      void getSupabaseAdmin()
        .storage.from(bucket)
        .download(objectPath)
        .then(async ({ data, error }) => {
          if (error || !data) {
            pass.destroy(error ?? new ObjectNotFoundError());
            return;
          }
          pass.push(Buffer.from(await data.arrayBuffer()));
          pass.push(null);
        })
        .catch((err) => pass.destroy(err));
      return pass;
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

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    if (useSupabaseStorage()) {
      return [`/${supabasePublicBucket()}/public`];
    }
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set, or use SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    if (useSupabaseStorage()) {
      return `/${supabasePrivateBucket()}/uploads`;
    }
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set, or use SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<ObjectFileHandle | null> {
    if (useSupabaseStorage()) {
      const bucket = supabasePublicBucket();
      const objectPath = `public/${filePath}`;
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(objectPath);
      if (error || !data) return null;
      return supabaseHandle(bucket, objectPath);
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return gcsHandle(file);
      }
    }
    return null;
  }

  async downloadObject(
    file: ObjectFileHandle,
    cacheTtlSec: number = 3600,
    objectPathHint?: string,
  ): Promise<Response> {
    const metadata = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

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
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(fileExtension = ""): Promise<string> {
    const objectId = randomUUID();
    const ext = fileExtension.startsWith(".") ? fileExtension : fileExtension ? `.${fileExtension}` : "";

    if (useSupabaseStorage()) {
      const bucket = supabasePrivateBucket();
      const objectPath = `uploads/${objectId}${ext}`;
      const { data, error } = await getSupabaseAdmin()
        .storage.from(bucket)
        .createSignedUploadUrl(objectPath);
      if (error || !data?.signedUrl) {
        throw new Error(`Supabase signed upload failed: ${error?.message ?? "unknown"}`);
      }
      return data.signedUrl;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}${ext}`;
    const { bucketName, objectName } = parseObjectPath(
      fullPath.startsWith("/") ? fullPath : `/${fullPath}`,
    );
    return signGcsObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
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

    if (useSupabaseStorage()) {
      const bucket = supabasePrivateBucket();
      const storagePath = entityId.startsWith("uploads/")
        ? entityId
        : `uploads/${entityId}`;
      const { error } = await getSupabaseAdmin().storage.from(bucket).download(storagePath);
      if (error) throw new ObjectNotFoundError();
      let storedType: string | null = null;
      try {
        const { data: listed } = await getSupabaseAdmin().storage.from(bucket).list(
          storagePath.includes("/") ? storagePath.split("/").slice(0, -1).join("/") : "",
          { search: storagePath.split("/").pop() },
        );
        const meta = listed?.find((f) => f.name === storagePath.split("/").pop());
        if (meta?.metadata && typeof meta.metadata === "object") {
          const m = meta.metadata as Record<string, unknown>;
          if (typeof m.mimetype === "string") storedType = m.mimetype;
        }
      } catch {
        /* optional metadata */
      }
      return supabaseHandle(bucket, storagePath, storedType);
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return gcsHandle(objectFile);
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

    if (useSupabaseStorage()) {
      const bucket = supabasePrivateBucket();
      const storagePath = entityId.startsWith("uploads/")
        ? entityId
        : `uploads/${entityId}`;
      const { error } = await getSupabaseAdmin().storage.from(bucket).remove([storagePath]);
      if (error) {
        throw new Error(`Supabase object delete failed: ${error.message}`);
      }
      return;
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (useSupabaseStorage()) {
      if (rawPath.startsWith("/objects/")) return rawPath;
      const uploadsMatch = rawPath.match(/uploads\/([^/?#]+)/);
      if (uploadsMatch) return `/objects/uploads/${uploadsMatch[1]}`;
      const extMatch = rawPath.match(/uploads\/([a-f0-9-]+)(\.[a-z0-9]+)/i);
      if (extMatch) return `/objects/uploads/${extMatch[1]}${extMatch[2]}`;
      try {
        const url = new URL(rawPath);
        const pathMatch = url.pathname.match(/uploads\/([^/]+)/);
        if (pathMatch) return `/objects/uploads/${pathMatch[1]}`;
      } catch {
        /* not a URL */
      }
      return rawPath;
    }

    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    if (useSupabaseStorage()) {
      return normalizedPath;
    }

    const parts = normalizedPath.slice(1).split("/");
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const { bucketName, objectName } = parseObjectPath(`${entityDir}${entityId}`);
    const gcsFile = objectStorageClient.bucket(bucketName).file(objectName);
    await setObjectAclPolicy(gcsFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: ObjectFileHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (useSupabaseStorage()) {
      return true;
    }
    return canAccessObject({
      userId,
      objectFile: objectFile as unknown as File,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signGcsObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const actionMap: Record<string, "read" | "write" | "delete"> = {
    GET: "read",
    PUT: "write",
    DELETE: "delete",
    HEAD: "read",
  };
  const action = actionMap[method] || "read";
  const [url] = await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl({
      version: "v4",
      action,
      expires: Date.now() + ttlSec * 1000,
    });
  return url;
}

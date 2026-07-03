import { useState, useCallback } from "react";
import type { UppyFile } from "@uppy/core";

interface UploadMetadata {
  name: string;
  size: number;
  contentType: string;
}

interface UploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadMetadata;
}

interface UseUploadOptions {
  /** Base path where object storage routes are mounted (default: "/api/storage") */
  basePath?: string;
  purpose?: "couple" | "venue";
  venueSlug?: string;
  uploadToken?: string;
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

type AllowedImageContentType = "image/jpeg" | "image/png" | "image/webp";

const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
const MIN_IMAGE_EDGE_PX = 512;

function allowedImageContentType(type: string | null | undefined): AllowedImageContentType {
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") {
    return type;
  }
  throw new Error("Upload must be a JPG, PNG, or WebP image.");
}

function fileSizeBytes(file: File | UppyFile<Record<string, unknown>, Record<string, unknown>>): number {
  const size = typeof file.size === "number" ? file.size : undefined;
  if (typeof size === "number" && Number.isFinite(size)) return size;
  const data = (file as UppyFile<Record<string, unknown>, Record<string, unknown>>).data;
  return data instanceof Blob ? data.size : 0;
}

async function imageDimensionsFromBlob(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Upload image could not be read."));
    };
    img.src = url;
  });
}

async function assertValidImageUpload(file: File | UppyFile<Record<string, unknown>, Record<string, unknown>>): Promise<AllowedImageContentType> {
  const contentType = allowedImageContentType(file.type);
  const size = fileSizeBytes(file);
  if (size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Upload images up to 50MB.");
  }

  const blob = file instanceof Blob
    ? file
    : (file as UppyFile<Record<string, unknown>, Record<string, unknown>>).data;
  if (!(blob instanceof Blob)) {
    throw new Error("Upload image could not be read.");
  }

  const dimensions = await imageDimensionsFromBlob(blob);
  if (dimensions.width < MIN_IMAGE_EDGE_PX || dimensions.height < MIN_IMAGE_EDGE_PX) {
    throw new Error(`Upload images at least ${MIN_IMAGE_EDGE_PX}px wide and tall.`);
  }

  return contentType;
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * This hook implements the two-step presigned URL upload flow:
 * 1. Request a presigned URL from your backend (sends JSON metadata, NOT the file)
 * 2. Upload the file directly to the presigned URL
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, error } = useUpload({
 *     onSuccess: (response) => {
 *       console.log("Uploaded to:", response.objectPath);
 *     },
 *   });
 *
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) {
 *       await uploadFile(file);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={handleFileChange} disabled={isUploading} />
 *       {isUploading && <p>Uploading...</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload(options: UseUploadOptions = {}) {
  const basePath = options.basePath ?? "/api/storage";
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const requestUploadUrl = useCallback(
    async (file: File): Promise<UploadResponse> => {
      const contentType = await assertValidImageUpload(file);
      const response = await fetch(`${basePath}/uploads/request-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType,
          purpose: options.purpose,
          venueSlug: options.venueSlug,
          uploadToken: options.uploadToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get upload URL");
      }

      return response.json();
    },
    [basePath, options.purpose, options.uploadToken, options.venueSlug]
  );

  const uploadToPresignedUrl = useCallback(
    async (file: File, uploadURL: string): Promise<void> => {
      const contentType = allowedImageContentType(file.type);
      const response = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": contentType,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to upload file to storage");
      }
    },
    []
  );

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        setProgress(10);
        const uploadResponse = await requestUploadUrl(file);

        setProgress(30);
        await uploadToPresignedUrl(file, uploadResponse.uploadURL);

        setProgress(100);
        options.onSuccess?.(uploadResponse);
        return uploadResponse;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed");
        setError(error);
        options.onError?.(error);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [requestUploadUrl, uploadToPresignedUrl, options]
  );

  const getUploadParameters = useCallback(
    async (
      file: UppyFile<Record<string, unknown>, Record<string, unknown>>
    ): Promise<{
      method: "PUT";
      url: string;
      headers?: Record<string, string>;
    }> => {
      const contentType = await assertValidImageUpload(file);
      const response = await fetch(`${basePath}/uploads/request-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType,
          purpose: options.purpose,
          venueSlug: options.venueSlug,
          uploadToken: options.uploadToken,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get upload URL");
      }

      const data = await response.json();
      return {
        method: "PUT",
        url: data.uploadURL,
        headers: { "Content-Type": contentType },
      };
    },
    [basePath, options.purpose, options.uploadToken, options.venueSlug]
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
  };
}

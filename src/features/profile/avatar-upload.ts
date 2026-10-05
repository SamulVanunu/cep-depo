const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

type AllowedMimeType = keyof typeof MIME_EXTENSIONS;

export type AvatarUploadDependencies = {
  fetchFile(uri: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  storage: {
    upload(
      path: string,
      data: ArrayBuffer,
      options: { contentType: string; upsert: true },
    ): Promise<{ error: unknown | null }>;
    remove(paths: string[]): Promise<{ error: unknown | null }>;
  };
  profile: {
    updateAvatarPath(userId: string, avatarPath: string | null): Promise<unknown>;
  };
};

type AvatarInput = Readonly<{
  userId: string;
  uri: string;
  mimeType: string;
  size: number;
  previousAvatarPath?: string | null;
}>;

function isAllowedMimeType(value: string): value is AllowedMimeType {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, value);
}

function validUserId(userId: string): boolean {
  return userId.trim().length > 0 && !userId.includes('/') && !userId.includes('\\');
}

export async function uploadAvatar(
  input: AvatarInput,
  deps: AvatarUploadDependencies,
): Promise<string> {
  if (!isAllowedMimeType(input.mimeType)) {
    throw new Error('Yalnız PNG, JPEG veya WebP görselleri kullanılabilir.');
  }
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > MAX_AVATAR_BYTES) {
    throw new Error('Avatar en fazla 5 MB olabilir.');
  }
  if (!validUserId(input.userId) || !input.uri) {
    throw new Error('Avatar yüklenemedi. Lütfen tekrar deneyin.');
  }

  const path = `${input.userId}/avatar.${MIME_EXTENSIONS[input.mimeType]}`;
  let data: ArrayBuffer;
  try {
    const response = await deps.fetchFile(input.uri);
    data = await response.arrayBuffer();
  } catch {
    throw new Error('Avatar yüklenemedi. Lütfen tekrar deneyin.');
  }

  try {
    const { error } = await deps.storage.upload(path, data, {
      contentType: input.mimeType,
      upsert: true,
    });
    if (error) throw new Error('upload failed');
  } catch {
    throw new Error('Avatar yüklenemedi. Lütfen tekrar deneyin.');
  }

  if (input.previousAvatarPath !== path) {
    try {
      await deps.profile.updateAvatarPath(input.userId, path);
    } catch {
      try {
        await deps.storage.remove([path]);
      } catch {
        // Best-effort cleanup; the profile still retains its previous reference.
      }
      throw new Error('Avatar güncellenemedi. Lütfen tekrar deneyin.');
    }
  }

  return path;
}

export async function removeAvatar(
  userId: string,
  currentPath: string,
  deps: AvatarUploadDependencies,
): Promise<void> {
  const ownAvatarPattern = new RegExp(
    `^${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/avatar\\.(png|jpg|jpeg|webp)$`,
  );
  if (!validUserId(userId) || !ownAvatarPattern.test(currentPath)) {
    throw new Error('Avatar kaldırılamadı. Lütfen tekrar deneyin.');
  }

  try {
    await deps.profile.updateAvatarPath(userId, null);
  } catch {
    throw new Error('Avatar kaldırılamadı. Lütfen tekrar deneyin.');
  }

  try {
    await deps.storage.remove([currentPath]);
  } catch {
    // The profile reference is already cleared; orphan cleanup can be retried later.
  }
}

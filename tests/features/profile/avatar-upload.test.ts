import {
  removeAvatar,
  uploadAvatar,
  type AvatarUploadDependencies,
} from '../../../src/features/profile/avatar-upload';

function dependencies() {
  const arrayBuffer = new ArrayBuffer(8);
  const fetchFile = jest.fn().mockResolvedValue({ arrayBuffer: jest.fn().mockResolvedValue(arrayBuffer) });
  const upload = jest.fn().mockResolvedValue({ error: null });
  const remove = jest.fn().mockResolvedValue({ error: null });
  const updateAvatarPath = jest.fn().mockResolvedValue(undefined);

  return {
    deps: {
      fetchFile,
      storage: { upload, remove },
      profile: { updateAvatarPath },
    } satisfies AvatarUploadDependencies,
    arrayBuffer,
    fetchFile,
    upload,
    remove,
    updateAvatarPath,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('İşlemin hata vermesi bekleniyordu.');
}

describe('uploadAvatar', () => {
  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
  ] as const)('uploads %s to the deterministic own path', async (mimeType, extension) => {
    const mock = dependencies();

    await expect(
      uploadAvatar(
        { userId: 'user-1', uri: 'file:///avatar', mimeType, size: 512 },
        mock.deps,
      ),
    ).resolves.toBe(`user-1/avatar.${extension}`);

    expect(mock.fetchFile).toHaveBeenCalledWith('file:///avatar');
    expect(mock.upload).toHaveBeenCalledWith(
      `user-1/avatar.${extension}`,
      mock.arrayBuffer,
      { contentType: mimeType, upsert: true },
    );
    expect(mock.updateAvatarPath).toHaveBeenCalledWith(
      'user-1',
      `user-1/avatar.${extension}`,
    );
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it.each(['image/gif', 'image/svg+xml', 'application/octet-stream'])(
    'rejects disallowed MIME type %s before reading or uploading',
    async mimeType => {
      const mock = dependencies();

      await expect(
        uploadAvatar(
          { userId: 'user-1', uri: 'file:///avatar', mimeType, size: 512 },
          mock.deps,
        ),
      ).rejects.toThrow('Yalnız PNG, JPEG veya WebP görselleri kullanılabilir.');
      expect(mock.fetchFile).not.toHaveBeenCalled();
      expect(mock.upload).not.toHaveBeenCalled();
    },
  );

  it('rejects files over 5 MB before reading or uploading', async () => {
    const mock = dependencies();

    await expect(
      uploadAvatar(
        {
          userId: 'user-1',
          uri: 'file:///large.png',
          mimeType: 'image/png',
          size: 5 * 1024 * 1024 + 1,
        },
        mock.deps,
      ),
    ).rejects.toThrow('Avatar en fazla 5 MB olabilir.');
    expect(mock.fetchFile).not.toHaveBeenCalled();
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it('attempts new-object cleanup when the profile update fails', async () => {
    const mock = dependencies();
    mock.updateAvatarPath.mockRejectedValue(new Error('profiles secret policy detail'));

    const error = await rejectionOf(
      uploadAvatar(
        { userId: 'user-1', uri: 'file:///avatar.png', mimeType: 'image/png', size: 512 },
        mock.deps,
      ),
    );

    expect(mock.remove).toHaveBeenCalledWith(['user-1/avatar.png']);
    expect(error.message).toBe('Avatar güncellenemedi. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('profiles');
    expect(error.message).not.toContain('secret');
  });

  it('preserves an existing profile reference when upserting the same deterministic path', async () => {
    const mock = dependencies();

    await expect(
      uploadAvatar(
        {
          userId: 'user-1',
          uri: 'file:///avatar.png',
          mimeType: 'image/png',
          size: 512,
          previousAvatarPath: 'user-1/avatar.png',
        },
        mock.deps,
      ),
    ).resolves.toBe('user-1/avatar.png');

    expect(mock.updateAvatarPath).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
  });

  it('sanitizes upload failures and does not update the profile', async () => {
    const mock = dependencies();
    mock.upload.mockResolvedValue({ error: { message: 'bucket secret detail' } });

    const error = await rejectionOf(
      uploadAvatar(
        { userId: 'user-1', uri: 'file:///avatar.png', mimeType: 'image/png', size: 512 },
        mock.deps,
      ),
    );

    expect(mock.updateAvatarPath).not.toHaveBeenCalled();
    expect(error.message).toBe('Avatar yüklenemedi. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('bucket');
  });

  it('sanitizes rejected storage requests', async () => {
    const mock = dependencies();
    mock.upload.mockRejectedValue(new Error('network endpoint with secret token'));

    const error = await rejectionOf(
      uploadAvatar(
        { userId: 'user-1', uri: 'file:///avatar.png', mimeType: 'image/png', size: 512 },
        mock.deps,
      ),
    );

    expect(error.message).toBe('Avatar yüklenemedi. Lütfen tekrar deneyin.');
    expect(error.message).not.toContain('secret');
    expect(mock.updateAvatarPath).not.toHaveBeenCalled();
  });
});

describe('removeAvatar', () => {
  it('clears the profile then removes only the current own avatar object', async () => {
    const mock = dependencies();

    await removeAvatar('user-1', 'user-1/avatar.webp', mock.deps);

    expect(mock.updateAvatarPath).toHaveBeenCalledWith('user-1', null);
    expect(mock.remove).toHaveBeenCalledWith(['user-1/avatar.webp']);
  });

  it('refuses to remove an object outside the own user folder', async () => {
    const mock = dependencies();

    await expect(removeAvatar('user-1', 'user-2/avatar.webp', mock.deps)).rejects.toThrow(
      'Avatar kaldırılamadı. Lütfen tekrar deneyin.',
    );
    expect(mock.updateAvatarPath).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
  });
});

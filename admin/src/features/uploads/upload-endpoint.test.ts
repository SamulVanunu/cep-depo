import { describe, expect, it } from 'vitest';

import { resumableUploadEndpoint } from './upload-endpoint';

describe('resumableUploadEndpoint', () => {
  it('uses the local Supabase gateway for local development', () => {
    expect(resumableUploadEndpoint('http://127.0.0.1:56321')).toBe(
      'http://127.0.0.1:56321/storage/v1/upload/resumable/sign',
    );
  });

  it('uses the direct storage host for a hosted Supabase project', () => {
    expect(resumableUploadEndpoint('https://sample.supabase.co')).toBe(
      'https://sample.storage.supabase.co/storage/v1/upload/resumable/sign',
    );
  });
});

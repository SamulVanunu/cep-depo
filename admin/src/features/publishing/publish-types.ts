import type { PublishAppOption } from '../apps/publish-app-options';

export type PublishStep = 'app' | 'apk' | 'review' | 'complete';

export type SelectedPublishApp = PublishAppOption & Readonly<{
  isNew: boolean;
}>;

export type PublishReview = Readonly<{
  app: SelectedPublishApp;
  versionId: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  size: number;
  sha256: string;
  changelog: string;
  source:
    | Readonly<{ kind: 'storage' }>
    | Readonly<{ kind: 'external'; hostname: string }>;
}>;

export type PublishWizardState = Readonly<{
  step: PublishStep;
  app: SelectedPublishApp | null;
  review: PublishReview | null;
}>;

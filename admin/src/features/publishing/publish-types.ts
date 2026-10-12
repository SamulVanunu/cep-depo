import type { PublishAppOption } from '../apps/publish-app-options';

export type PublishStep = 'app' | 'apk' | 'review' | 'complete';

export type SelectedPublishApp = PublishAppOption & Readonly<{
  isNew: boolean;
}>;

export type PublishDraftReview = Readonly<{
  versionId: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  size: number;
  sha256: string;
  changelog: string;
}>;

export type PublishWizardState = Readonly<{
  step: PublishStep;
  app: SelectedPublishApp | null;
  review: PublishDraftReview | null;
}>;

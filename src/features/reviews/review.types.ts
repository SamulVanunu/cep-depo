export type RatingSummary = Readonly<{
  average: number | null;
  count: number;
}>;

export type Review = Readonly<{
  id: string;
  appId: string;
  userId: string;
  username: string;
  avatarPath: string | null;
  rating: number;
  body: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ReviewDraft = Readonly<{
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
}>;

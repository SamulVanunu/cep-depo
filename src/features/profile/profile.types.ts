export type Profile = Readonly<{
  userId: string;
  username: string;
  avatarPath: string | null;
  status: 'active' | 'suspended';
}>;

export type AccountReview = Readonly<{
  id: string;
  appSlug: string;
  appTitle: string;
  rating: number;
  body: string | null;
  updatedAt: string;
}>;

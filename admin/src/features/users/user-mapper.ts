type AuthUserInput = Readonly<{
  id: string;
  email?: string;
  email_confirmed_at?: string;
  created_at: string;
  last_sign_in_at?: string;
  banned_until?: string;
  user_metadata?: unknown;
  app_metadata?: unknown;
}>;

type ProfileInput = Readonly<{
  user_id: string;
  username: string;
  avatar_path: string | null;
  status: 'active' | 'suspended';
  created_at: string;
}>;

export function authBanIsActive(until: string | undefined): boolean {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

export function userConsistency(profileStatus: 'active' | 'suspended', banned: boolean) {
  return (profileStatus === 'suspended') === banned ? 'consistent' as const : 'partial' as const;
}

export function mapManagedUsers(
  users: readonly AuthUserInput[],
  profiles: readonly ProfileInput[],
  roles: readonly Readonly<{ user_id: string; role: string }>[],
  reviews: readonly Readonly<{ user_id: string }>[],
  reports: readonly Readonly<{ reporter_id: string }>[],
) {
  const profileMap = new Map(profiles.map(profile => [profile.user_id, profile]));
  return users.flatMap(user => {
    const profile = profileMap.get(user.id);
    if (!profile) return [];
    const banned = authBanIsActive(user.banned_until);
    return [{
      id: user.id,
      email: user.email ?? '',
      emailConfirmedAt: user.email_confirmed_at ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      username: profile.username,
      avatarPath: profile.avatar_path,
      status: profile.status,
      banned,
      isAdmin: roles.some(role => role.user_id === user.id && role.role === 'admin'),
      reviewCount: reviews.filter(review => review.user_id === user.id).length,
      reportCount: reports.filter(report => report.reporter_id === user.id).length,
      consistency: userConsistency(profile.status, banned),
    }];
  });
}

import type { Session, User } from '@supabase/supabase-js';

export type AuthState = Readonly<{
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  user: User | null;
}>;

export type AuthContextValue = AuthState;

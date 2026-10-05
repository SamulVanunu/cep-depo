import { type Href, useRouter } from 'expo-router';

import { SignInScreen } from '../../src/features/auth/SignInScreen';

export default function SignInRoute() {
  const router = useRouter();
  return (
    <SignInScreen
      onForgotPassword={() => router.push('/auth/forgot-password' as Href)}
      onSignedIn={() => router.replace('/(tabs)/account' as Href)}
      onSignUp={() => router.push('/auth/sign-up' as Href)}
    />
  );
}

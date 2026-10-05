import { type Href, useRouter } from 'expo-router';

import { SignUpScreen } from '../../src/features/auth/SignUpScreen';

export default function SignUpRoute() {
  const router = useRouter();
  return (
    <SignUpScreen
      onConfirmationRequired={email =>
        router.replace({ pathname: '/auth/confirm', params: { email } } as Href)
      }
      onSignIn={() => router.replace('/auth/sign-in' as Href)}
    />
  );
}

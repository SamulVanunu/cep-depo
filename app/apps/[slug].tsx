import { useLocalSearchParams } from 'expo-router';

import { AppDetailScreen } from '../../src/features/catalog/AppDetailScreen';

export default function AppDetailRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const normalizedSlug = typeof slug === 'string' ? slug.trim() : '';
  return <AppDetailScreen slug={normalizedSlug} />;
}

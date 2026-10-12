import { redirect } from 'next/navigation';

export default async function NewVersionPage({ params }: Readonly<{ params: Promise<{ appId: string }> }>) {
  const { appId } = await params;
  redirect(`/publish?appId=${encodeURIComponent(appId)}`);
}

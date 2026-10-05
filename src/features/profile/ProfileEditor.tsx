import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { colors, radii, spacing } from '../../theme/tokens';
import { validateUsername } from '../auth/auth.validation';
import type { Profile } from './profile.types';

export type PickedAvatar = Readonly<{
  uri: string;
  mimeType: string;
  size: number;
}>;

export type PickImage = (options: {
  mediaTypes: ['images'];
  allowsEditing: true;
  aspect: [1, 1];
  quality: number;
}) => Promise<{
  canceled: boolean;
  assets?: readonly {
    uri: string;
    mimeType?: string | null;
    fileSize?: number | null;
  }[] | null;
}>;

type ProfileEditorProps = {
  profile: Profile;
  avatarUrl: string | null;
  isUsernamePending: boolean;
  isAvatarPending: boolean;
  pickImage: PickImage;
  onUpdateUsername(username: string): Promise<void>;
  onUploadAvatar(avatar: PickedAvatar): Promise<void>;
  onRemoveAvatar(): Promise<void>;
};

export function ProfileEditor({
  profile,
  avatarUrl,
  isUsernamePending,
  isAvatarPending,
  pickImage,
  onUpdateUsername,
  onUploadAvatar,
  onRemoveAvatar,
}: ProfileEditorProps) {
  const [editingUsername, setEditingUsername] = useState(false);
  const [username, setUsername] = useState(profile.username);
  const [error, setError] = useState<string | null>(null);

  async function saveUsername() {
    const validationError = validateUsername(username);
    setError(validationError);
    if (validationError) return;
    try {
      await onUpdateUsername(username.trim());
      setEditingUsername(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Kullanıcı adı güncellenemedi.');
    }
  }

  async function selectAvatar() {
    setError(null);
    try {
      const result = await pickImage({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri || !asset.mimeType || !asset.fileSize) {
        setError('Seçilen görsel doğrulanamadı.');
        return;
      }
      await onUploadAvatar({
        uri: asset.uri,
        mimeType: asset.mimeType,
        size: asset.fileSize,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Avatar güncellenemedi.');
    }
  }

  async function clearAvatar() {
    setError(null);
    try {
      await onRemoveAvatar();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Avatar kaldırılamadı.');
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.avatarRow}>
        {avatarUrl ? (
          <Image accessibilityLabel={`${profile.username} avatarı`} source={{ uri: avatarUrl }} style={styles.avatar} />
        ) : (
          <View accessible accessibilityLabel="Avatar yok" style={styles.avatarPlaceholder}>
            <AppText variant="title">{profile.username.slice(0, 1).toLocaleUpperCase('tr-TR')}</AppText>
          </View>
        )}
        <View style={styles.avatarActions}>
          <Button
            label="Avatarı değiştir"
            loading={isAvatarPending}
            onPress={() => void selectAvatar()}
            variant="secondary"
          />
          {profile.avatarPath ? (
            <Button
              disabled={isAvatarPending}
              label="Avatarı kaldır"
              onPress={() => void clearAvatar()}
              variant="text"
            />
          ) : null}
        </View>
      </View>

      {editingUsername ? (
        <View style={styles.editor}>
          <FormField
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
            label="Kullanıcı adı"
            onChangeText={setUsername}
            value={username}
          />
          <View style={styles.editorActions}>
            <Button
              label="Kullanıcı adını kaydet"
              loading={isUsernamePending}
              onPress={() => void saveUsername()}
            />
            <Button
              disabled={isUsernamePending}
              label="Vazgeç"
              onPress={() => {
                setUsername(profile.username);
                setError(null);
                setEditingUsername(false);
              }}
              variant="text"
            />
          </View>
        </View>
      ) : (
        <View style={styles.usernameRow}>
          <View style={styles.usernameCopy}>
            <AppText variant="label">Kullanıcı adı</AppText>
            <AppText variant="title">{profile.username}</AppText>
          </View>
          <Button
            label="Kullanıcı adını düzenle"
            onPress={() => setEditingUsername(true)}
            variant="text"
          />
        </View>
      )}
      {!editingUsername && error ? <AppText tone="danger">{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceRaised },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  avatarActions: { flex: 1, gap: spacing.xs },
  editor: { gap: spacing.md },
  editorActions: { gap: spacing.sm },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  usernameCopy: { flex: 1, gap: spacing.xs },
});

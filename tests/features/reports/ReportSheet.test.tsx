import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { User } from '@supabase/supabase-js';

import { useAuth } from '../../../src/features/auth/auth-context';
import { useMyProfile } from '../../../src/features/profile/profile.queries';
import { ReportSheet } from '../../../src/features/reports/ReportSheet';
import { useOpenReport, useSubmitReport } from '../../../src/features/reports/report.queries';
import type { ReportTarget } from '../../../src/features/reports/report.types';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../src/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../../src/features/profile/profile.queries', () => ({ useMyProfile: jest.fn() }));
jest.mock('../../../src/features/reports/report.queries', () => ({
  useOpenReport: jest.fn(),
  useSubmitReport: jest.fn(),
}));

const target: ReportTarget = {
  appId: 'app-1',
  appTitle: 'Örnek Uygulama',
  versionId: 'version-1',
  versionName: '1.2.0',
};

function user(confirmed: boolean): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    email: 'user@example.com',
    email_confirmed_at: confirmed ? '2026-10-01T10:00:00Z' : undefined,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-01T09:00:00Z',
  };
}

describe('ReportSheet', () => {
  const mockAuth = useAuth as jest.MockedFunction<typeof useAuth>;
  const mockProfile = useMyProfile as jest.MockedFunction<typeof useMyProfile>;
  const mockOpen = useOpenReport as jest.MockedFunction<typeof useOpenReport>;
  const mockSubmit = useSubmitReport as jest.MockedFunction<typeof useSubmitReport>;
  const mutateAsync = jest.fn().mockResolvedValue({ id: 'report-1' });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockReturnValue({ status: 'signedOut', session: null, user: null });
    mockProfile.mockReturnValue({ data: undefined, isPending: false, isError: false } as never);
    mockOpen.mockReturnValue({ data: null, alreadyOpen: false, isPending: false, isError: false, refetch: jest.fn() } as never);
    mockSubmit.mockReturnValue({ mutateAsync, isPending: false } as never);
  });

  it('shows the exact app/version target and a dismiss action', () => {
    const onDismiss = jest.fn();
    render(<ReportSheet onDismiss={onDismiss} target={target} visible />);
    expect(screen.getByText('Örnek Uygulama')).toBeTruthy();
    expect(screen.getByText('Sürüm 1.2.0')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Şikâyet penceresini kapat' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('gates anonymous and unconfirmed reporters', () => {
    const view = render(<ReportSheet onDismiss={jest.fn()} target={target} visible />);
    fireEvent.press(screen.getByRole('button', { name: 'Şikâyet için giriş yap' }));
    expect(mockPush).toHaveBeenCalledWith('/auth/sign-in');

    const authUser = user(false);
    mockAuth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    view.rerender(<ReportSheet onDismiss={jest.fn()} target={target} visible />);
    fireEvent.press(screen.getByRole('button', { name: 'E-postayı doğrula' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/auth/confirm', params: { email: 'user@example.com' } });
  });

  it('shows suspended accounts a read-only notice', () => {
    const authUser = user(true);
    mockAuth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mockProfile.mockReturnValue({ data: { status: 'suspended' }, isPending: false, isError: false } as never);
    render(<ReportSheet onDismiss={jest.fn()} target={target} visible />);
    expect(screen.getByText('Hesabın askıya alındığı için şikâyet gönderemezsin.')).toBeTruthy();
  });

  it('requires a reason and validates the optional description', () => {
    const authUser = user(true);
    mockAuth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mockProfile.mockReturnValue({ data: { status: 'active' }, isPending: false, isError: false } as never);
    render(<ReportSheet onDismiss={jest.fn()} target={target} visible />);

    fireEvent.press(screen.getByRole('button', { name: 'Şikâyeti gönder' }));
    expect(screen.getByText('Lütfen bir şikâyet nedeni seçin.')).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: 'Diğer' }));
    fireEvent.changeText(screen.getByLabelText('Açıklama (isteğe bağlı)'), ' ab ');
    fireEvent.press(screen.getByRole('button', { name: 'Şikâyeti gönder' }));
    expect(screen.getByText('Açıklama boş bırakılmalı veya en az 3 karakter olmalıdır.')).toBeTruthy();
  });

  it('prevents duplicate submission and confirms success', async () => {
    let resolveSubmit: (() => void) | undefined;
    mutateAsync.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveSubmit = () => resolve({ id: 'report-1' } as never);
      }),
    );
    const authUser = user(true);
    mockAuth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mockProfile.mockReturnValue({ data: { status: 'active' }, isPending: false, isError: false } as never);
    render(<ReportSheet onDismiss={jest.fn()} target={target} visible />);
    fireEvent.press(screen.getByRole('radio', { name: 'İndirme bağlantısı bozuk' }));
    fireEvent.press(screen.getByRole('button', { name: 'Şikâyeti gönder' }));
    fireEvent.press(screen.getByRole('button', { name: 'Şikâyeti gönder' }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => resolveSubmit?.());
    expect(screen.getByText('Şikâyetin alındı.')).toBeTruthy();
  });

  it('disables submission when the exact target already has an open report', () => {
    const authUser = user(true);
    mockAuth.mockReturnValue({ status: 'signedIn', session: { user: authUser } as never, user: authUser });
    mockProfile.mockReturnValue({ data: { status: 'active' }, isPending: false, isError: false } as never);
    mockOpen.mockReturnValue({ data: { id: 'report-1' }, alreadyOpen: true, isPending: false, isError: false } as never);
    render(<ReportSheet onDismiss={jest.fn()} target={target} visible />);
    expect(screen.getByText('Bu hedef için açık bir şikâyetin zaten var.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Şikâyeti gönder' })).toBeNull();
  });
});

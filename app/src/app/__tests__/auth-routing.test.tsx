import { renderRouter, screen, act } from 'expo-router/testing-library';
import { Text } from 'react-native';

/**
 * Signing out must land on the login screen, once. It used to loop ("Maximum update depth exceeded") because
 * the entry screen redirected on every render while the screens guarded by sign-in were being removed.
 */

type Status = 'loading' | 'error' | 'locked' | 'signedOut' | 'ready';
let mockState: { status: Status } = { status: 'ready' };
const mockListeners = new Set<() => void>();
const setStatus = (status: Status) => {
  mockState = { status };
  mockListeners.forEach((l) => l());
};

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/state/AppProvider', () => {
  const { useSyncExternalStore } = require('react');
  return {
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
    useApp: () => {
      const s = useSyncExternalStore(
        (cb: () => void) => {
          mockListeners.add(cb);
          return () => mockListeners.delete(cb);
        },
        () => mockState,
      );
      return { status: s.status, error: null, appearance: { scheme: 'light', preference: 'system', setPreference: () => undefined } };
    },
  };
});

const Stub = (label: string) => function StubScreen() {
  return <Text>{label}</Text>;
};

function mount() {
  return renderRouter(
    {
      _layout: require('../_layout').default,
      index: require('../index').default,
      login: Stub('LOGIN'),
      '(tabs)/_layout': require('expo-router').Slot,
      '(tabs)/index': Stub('HOME'),
      'member/[code]': Stub('MEMBER'),
      'collect/[code]': Stub('COLLECT'),
      register: Stub('REGISTER'),
      history: Stub('HISTORY'),
    },
    { initialUrl: '/' },
  );
}

describe('signing in and out', () => {
  beforeEach(() => setStatus('loading'));

  test('the loading screen gives way to the login screen, then to home on sign-in, and back on sign-out', async () => {
    await mount();
    expect(screen.queryByText('LOGIN')).toBeNull();
    await act(async () => setStatus('signedOut'));
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    await act(async () => setStatus('ready'));
    expect(await screen.findByText('HOME')).toBeTruthy();
    await act(async () => setStatus('signedOut'));
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    expect(screen.queryByText('HOME')).toBeNull();
  });

  test('an app that opens locked shows the login screen', async () => {
    await mount();
    await act(async () => setStatus('locked'));
    expect(await screen.findByText('LOGIN')).toBeTruthy();
  });
});

import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BootstrapGate } from '../../../src/features/bootstrap/BootstrapGate';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('BootstrapGate', () => {
  it('keeps the logo visible only while required startup work is pending', async () => {
    const startup = deferred();
    render(
      <BootstrapGate
        getReduceMotion={async () => true}
        startup={() => startup.promise}
      >
        <ReadyContent />
      </BootstrapGate>,
    );

    expect(screen.getByLabelText('Cep Depo açılıyor')).toBeTruthy();
    expect(screen.queryByText('Uygulama hazır')).toBeNull();
    startup.resolve();

    await waitFor(() => expect(screen.queryByLabelText('Cep Depo açılıyor')).toBeNull());
    expect(screen.getByText('Uygulama hazır')).toBeTruthy();
  });

  it('skips motion when reduce motion is enabled', async () => {
    const runExitAnimation = jest.fn();
    render(
      <BootstrapGate
        getReduceMotion={async () => true}
        runExitAnimation={runExitAnimation}
        startup={async () => undefined}
      >
        <ReadyContent />
      </BootstrapGate>,
    );

    await screen.findByText('Uygulama hazır');
    expect(runExitAnimation).not.toHaveBeenCalled();
  });

  it('starts one short exit animation after startup when motion is allowed', async () => {
    const runExitAnimation = jest.fn((_values, complete: () => void) => complete());
    render(
      <BootstrapGate
        getReduceMotion={async () => false}
        runExitAnimation={runExitAnimation}
        startup={async () => undefined}
      >
        <ReadyContent />
      </BootstrapGate>,
    );

    await screen.findByText('Uygulama hazır');
    expect(runExitAnimation).toHaveBeenCalledTimes(1);
  });
});

function ReadyContent() {
  return <Text>Uygulama hazır</Text>;
}

import { type PropsWithChildren, useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { colors, motion } from '../../theme/tokens';
import { LogoMark } from './LogoMark';

type AnimationValues = Readonly<{
  opacity: Animated.Value;
  scale: Animated.Value;
}>;

type BootstrapGateProps = PropsWithChildren<{
  startup: () => Promise<unknown>;
  getReduceMotion?: () => Promise<boolean>;
  runExitAnimation?: (values: AnimationValues, complete: () => void) => void;
}>;

function defaultExitAnimation(values: AnimationValues, complete: () => void) {
  Animated.parallel([
    Animated.timing(values.opacity, {
      toValue: 0,
      duration: motion.normal,
      useNativeDriver: true,
    }),
    Animated.timing(values.scale, {
      toValue: 0.96,
      duration: motion.normal,
      useNativeDriver: true,
    }),
  ]).start(complete);
}

export function BootstrapGate({
  children,
  startup,
  getReduceMotion = AccessibilityInfo.isReduceMotionEnabled,
  runExitAnimation = defaultExitAnimation,
}: BootstrapGateProps) {
  const [ready, setReady] = useState(false);
  const [values] = useState(() => ({
    opacity: new Animated.Value(1),
    scale: new Animated.Value(1),
  }));

  useEffect(() => {
    let active = true;
    const startupWork = startup().catch(() => undefined);
    const motionPreference = getReduceMotion().catch(() => false);

    async function finishStartup() {
      await startupWork;
      const reduceMotion = await motionPreference;
      if (!active) return;
      if (reduceMotion) {
        setReady(true);
        return;
      }
      runExitAnimation(values, () => {
        if (active) setReady(true);
      });
    }

    void finishStartup();
    return () => {
      active = false;
    };
  }, [getReduceMotion, runExitAnimation, startup, values]);

  if (ready) return children;
  return (
    <Animated.View
      style={[
        styles.screen,
        { opacity: values.opacity, transform: [{ scale: values.scale }] },
      ]}
    >
      <LogoMark accessibilityLabel="Cep Depo açılıyor" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

const config = require('../../app.json').expo;

describe('mobile 0.3.1 native configuration', () => {
  it('uses the next immutable Android release version', () => {
    expect(config.version).toBe('0.3.1');
    expect(config.android.versionCode).toBe(4);
  });

  it('configures a dark native splash instead of the default gray screen', () => {
    const splash = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    expect(splash?.[1]).toEqual(expect.objectContaining({
      backgroundColor: '#111315',
      image: './assets/app-icon.png',
    }));
  });

  it('declares permission to hand verified APKs to the Android installer', () => {
    expect(config.android.permissions).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
  });
});

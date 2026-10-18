import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT=demo builds a separate "DailyDairy Demo" app (own package id, so it never replaces a real install)
 * that talks to the local demo API over plain HTTP on your Wi-Fi. Every other build keeps HTTPS-only networking.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const demo = process.env.APP_VARIANT === 'demo';
  return {
    ...config,
    name: demo ? 'DailyDairy Demo' : 'DailyDairy',
    slug: 'dailydairy',
    android: { ...config.android, package: demo ? 'com.dailydairy.app.demo' : 'com.dailydairy.app' },
    ios: { ...config.ios, bundleIdentifier: demo ? 'com.dailydairy.app.demo' : 'com.dailydairy.app' },
    plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: demo } }]],
    extra: { ...config.extra, eas: { ...(config.extra?.eas ?? {}), ...(process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : {}) } },
  };
};

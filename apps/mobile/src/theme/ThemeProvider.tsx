import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type Colors } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';
interface ThemeCtx { colors: Colors; isDark: boolean; mode: ThemeMode; setMode: (m: ThemeMode) => void }
const Ctx = createContext<ThemeCtx>({ colors: lightColors, isDark: false, mode: 'system', setMode: () => undefined });
const KEY = 'theme-mode';

export function ThemeProvider({ children, initialMode = 'system' }: { children: React.ReactNode; initialMode?: ThemeMode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => { if (v === 'light' || v === 'dark' || v === 'system') setModeState(v); }).catch(() => undefined);
  }, []);
  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => undefined);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo(() => ({ colors: isDark ? darkColors : lightColors, isDark, mode, setMode }), [isDark, mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);

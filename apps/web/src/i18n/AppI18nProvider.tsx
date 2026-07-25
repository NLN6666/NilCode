// FILE: i18n/AppI18nProvider.tsx
// Purpose: Bind the persisted `language` setting to the i18n context at the app root.

import type { ReactNode } from "react";
import { useAppSettings } from "../appSettings";
import { I18nProvider } from "./I18nProvider";

export function AppI18nProvider({ children }: { readonly children: ReactNode }) {
  const { settings } = useAppSettings();

  return <I18nProvider locale={settings.language}>{children}</I18nProvider>;
}

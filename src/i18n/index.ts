import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./locales";

export enum LocaleEnum {
  Chinese = "zh-cn",
  English = "en-us",
  // TODO: other locales
  German = "de",
  Korean = "ko",
  Japanese = "ja",
  French = "fr",
  Russian = "ru",
  Italian = "it",
}

i18n.use(initReactI18next).init({
  resources,
  fallbackLng: LocaleEnum.English,
  lng: LocaleEnum.English,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

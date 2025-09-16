import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./locales";
import { getAuthStore } from "@/store/authStore";

export enum LocaleEnum {
  SimplifiedChinese = "zh-Hans",
  TraditionalChinese = "zh-Hant",
  English = "en-US",
  German = "de",
  Korean = "ko",
  Japanese = "ja",
  French = "fr",
  Russian = "ru",
  Italian = "it",
  Arabic = "ar",
  Spanish = "es",
}

const { language } = getAuthStore();

const savedLanguage = language?.toLowerCase();
const systemLanguage = navigator.language.toLowerCase();
const availableLanguages = Object.values(LocaleEnum);

let initialLanguage: string;

if (savedLanguage && availableLanguages.includes(savedLanguage as LocaleEnum)) {
  initialLanguage = savedLanguage;
} else {
  const matched = availableLanguages.find(lang => systemLanguage.startsWith(lang));
  initialLanguage = matched || LocaleEnum.English;
}


i18n.use(initReactI18next).init({
  resources,
  fallbackLng: LocaleEnum.English,
  lng: initialLanguage,
  interpolation: {
    escapeValue: false,
  },
});

export const switchLanguage = (lang: LocaleEnum) => {
  console.log("switchLanguage", lang);
  i18n.changeLanguage(lang);
  getAuthStore().setLanguage(lang);
};

export default i18n;

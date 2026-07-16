import { describe, it, expect } from "vitest";
import { translate, resolveLocale, LOCALES } from "../src/i18n";

describe("translate", () => {
  it("returns the string for en and ja", () => {
    expect(translate("en", "export.run")).toBe("Export");
    expect(translate("ja", "export.run")).toBe("書き出す");
  });
  it("falls back to en then the key for a missing entry", () => {
    expect(translate("en", "no.such.key")).toBe("no.such.key");
    expect(translate("fr", "no.such.key")).toBe("no.such.key");
  });
  it("uses each locale's own translation when present", () => {
    expect(translate("fr", "export.run")).toBe("Exporter");
    expect(translate("ko", "status.exported")).toBe("내보냈습니다");
  });
  it("has the new color-theme keys in every locale", () => {
    const keys = [
      "title.colorTheme", "theme.system", "theme.light", "theme.dark", "theme.custom",
      "theme.customTitle", "theme.fieldBase", "theme.fieldBg", "theme.fieldPanel",
      "theme.fieldAccent", "theme.fieldText", "theme.cancel", "theme.apply",
    ];
    for (const locale of LOCALES.map((l) => l.code)) {
      for (const key of keys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});

describe("resolveLocale", () => {
  it("honors a valid stored value", () => {
    expect(resolveLocale("zh-TW", "en-US")).toBe("zh-TW");
    expect(resolveLocale("ru", "ja-JP")).toBe("ru");
  });
  it("maps navigator language when stored is absent/invalid", () => {
    expect(resolveLocale(null, "ja")).toBe("ja");
    expect(resolveLocale(null, "zh-TW")).toBe("zh-TW");
    expect(resolveLocale(null, "zh-Hant")).toBe("zh-TW");
    expect(resolveLocale(null, "zh-CN")).toBe("zh-CN");
    expect(resolveLocale(null, "zh")).toBe("zh-CN");
    expect(resolveLocale(null, "ko-KR")).toBe("ko");
    expect(resolveLocale(null, "fr-FR")).toBe("fr");
    expect(resolveLocale(null, "pt-BR")).toBe("pt");
    expect(resolveLocale("xx", "de")).toBe("de");
    expect(resolveLocale(null, "xx")).toBe("en");
  });
  it("lists 11 locales with short codes", () => {
    expect(LOCALES.map((l) => l.short)).toEqual(
      ["EN", "JA", "TW", "CN", "KR", "FR", "ES", "DE", "PT", "IT", "RU"],
    );
  });
});

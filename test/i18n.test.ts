import { describe, it, expect } from "vitest";
import { DICT, translate, resolveLocale, LOCALES } from "../src/i18n";

describe("translate", () => {
  it("returns the string for en and ja", () => {
    expect(translate("en", "export.run")).toBe("Export");
    expect(translate("ja", "export.run")).toBe("書き出す");
  });
  it("falls back to en then the key for a missing entry", () => {
    expect(translate("en", "no.such.key")).toBe("no.such.key");
    expect(translate("fr", "no.such.key")).toBe("no.such.key");
  });

  it("localizes edge routing controls in every locale", () => {
    expect(translate("en", "btn.edgeRouting")).toBe("Adjust edges");
    expect(translate("ja", "btn.edgeRouting")).toBe("配線調整");
    expect(translate("fr", "btn.edgeRouting")).toBe("Ajuster les liaisons");
    expect(translate("en", "status.edgeSelected")).toBe(
      "Edge selected; click it to add a route point",
    );
    expect(translate("ja", "status.edgeSelected")).toBe(
      "配線を選択しました。クリックで経由点を追加できます",
    );
  });
  it("uses each locale's own translation when present", () => {
    expect(translate("fr", "export.run")).toBe("Exporter");
    expect(translate("ko", "status.exported")).toBe("내보냈습니다");
  });
  it("uses the diagram-specific wording for the edge modes", () => {
    expect(translate("en", "edge.modeSmooth")).toBe("Smooth curve");
    expect(translate("ja", "edge.modeSmooth")).toBe("自動曲線");
  });
});

// `translate` falls back to English, so a missing entry is invisible through
// it. These check the per-locale tables directly, which is what keeps a new
// feature from shipping with nine locales silently reading English.
describe("locale coverage", () => {
  const codes = LOCALES.map((locale) => locale.code);

  it("defines every English key in every locale", () => {
    const missing = codes.flatMap((code) =>
      Object.keys(DICT.en)
        .filter((key) => !(key in DICT[code]))
        .map((key) => `${code}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("defines no key that English does not have", () => {
    const unknown = codes.flatMap((code) =>
      Object.keys(DICT[code])
        .filter((key) => !(key in DICT.en))
        .map((key) => `${code}: ${key}`),
    );
    expect(unknown).toEqual([]);
  });

  it("leaves no entry empty", () => {
    const blank = codes.flatMap((code) =>
      Object.entries(DICT[code])
        .filter(([, value]) => !value.trim())
        .map(([key]) => `${code}: ${key}`),
    );
    expect(blank).toEqual([]);
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

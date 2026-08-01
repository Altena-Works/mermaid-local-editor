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

  it("localizes edge routing controls and falls back to English", () => {
    expect(translate("ja", "btn.edgeRouting")).toBe("配線調整");
    expect(translate("fr", "btn.edgeRouting")).toBe("Adjust edges");
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
  it("has node movement and edge mode keys in every locale", () => {
    const keys = [
      "title.edgeDefaultMode",
      "title.edgeMode",
      "title.edgeAutoReroute",
      "title.nodeReset",
      "edge.defaultMode",
      "edge.mode",
      "edge.modeInherit",
      "edge.modeCorner",
      "edge.modeSmooth",
      "edge.autoReroute",
      "edge.autoRerouteHint",
      "edge.handleDeleteHint",
      "node.reset",
      "node.sourceJumpHint",
      "status.edgeModeChanged",
      "status.edgeAutoRerouted",
      "status.nodeReset",
      "status.nodeSourceRevealed",
      "status.nodeSourceNotFound",
      "status.nodeSourceUnsupported",
    ];
    for (const locale of LOCALES.map((item) => item.code)) {
      for (const key of keys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
    expect(translate("en", "edge.modeSmooth")).toBe("Smooth curve");
    expect(translate("ja", "edge.modeSmooth")).toBe("自動曲線");
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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCatalog() {
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../public/generated-i18n.js', import.meta.url), 'utf8'), { window });
  vm.runInNewContext(readFileSync(new URL('../public/generated-i18n-patterns.js', import.meta.url), 'utf8'), { window });
  vm.runInNewContext(readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8'), { window });
  return window.AGENT_GATEWAY_I18N;
}

test('desktop catalog exposes all supported languages including Turkish', () => {
  const catalog = loadCatalog();
  assert.deepEqual(Array.from(catalog.languages, (language) => language.code), ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'tr']);
  assert.equal(catalog.normalize('tr-TR'), 'tr');
  assert.equal(catalog.locale('tr'), 'tr-TR');
  assert.equal(catalog.translate('设置', 'tr', 'Settings'), 'Ayarlar');
  assert.equal(catalog.translate('API Gateway 监控', 'tr', 'API Gateway Monitor'), 'API Gateway izleyicisi');
});

test('desktop catalog contains every extracted UI message in every target language', () => {
  const catalog = loadCatalog();
  for (const language of ['ja', 'ko', 'es', 'fr', 'de', 'pt', 'tr']) {
    const missing = Array.from(catalog.requiredTranslations).filter((key) => !catalog.hasTranslation(language, key));
    assert.deepEqual(missing, [], `${language} is missing: ${missing.join(', ')}`);
  }
});

test('desktop catalog translates variable count and status messages', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.translateDynamic('5 min ago', 'ja'), '5 分前');
  assert.equal(catalog.translateDynamic('22 cumulative calls · 590,773 tokens', 'tr'), '22 toplam çağrı · 590,773 token');
  assert.equal(catalog.translateDynamic('Running · task-1', 'ja'), '実行中 · task-1');
});

test('platform homepage link is translated in every non-Chinese language', () => {
  const catalog = loadCatalog();
  assert.equal(catalog.translate('平台首页', 'en', 'Platform homepage'), 'Platform homepage');
  for (const language of ['ja', 'ko', 'es', 'fr', 'de', 'pt', 'tr']) {
    assert.notEqual(catalog.translate('平台首页', language, 'Platform homepage'), 'Platform homepage', language);
    assert.notEqual(catalog.translate('本地首页', language, 'Local homepage'), 'Local homepage', language);
    assert.notEqual(catalog.translate('公网首页', language, 'Public homepage'), 'Public homepage', language);
    assert.notEqual(catalog.translate('打开平台首页', language, 'Open platform homepage'), 'Open platform homepage', language);
  }
});

test('desktop application keeps model identifiers language-neutral', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /MODEL_OPTIONS\.includes\(englishMatch\[2\]\)/);
});

test('desktop application prefers exact UI translations before dynamic templates', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const exactTranslation = source.indexOf('I18N.hasTranslation?.(state.language, message)');
  const dynamicTranslation = source.indexOf('I18N.translateDynamic?.(message, state.language)');

  assert.ok(exactTranslation > 0);
  assert.ok(dynamicTranslation > exactTranslation);
});

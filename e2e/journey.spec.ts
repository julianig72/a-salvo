import { expect, test, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function pickMunicipality(scope: Locator, town: string, option: RegExp) {
  await scope.getByLabel('Tu municipio', { exact: true }).fill(town);
  await scope.getByRole('listbox', { name: 'Sugerencias: tu municipio' }).getByRole('option', { name: option }).first().click();
  await expect(scope.getByText(/Municipio verificado · INE/)).toBeVisible();
}

async function fillLocation(dialog: Locator, town: string, province: string, option: RegExp) {
  await pickMunicipality(dialog, town, option);
  await expect(dialog.getByLabel('Provincia o ciudad autónoma')).toHaveValue(province);
  await dialog.getByRole('button', { name: 'Continuar' }).click();
}

test('guía personalizada: vivienda, prioridades, tareas, kit, PDF, guardado y borrado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sabe qué hacer');
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /Crear mi plan familiar/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tu municipio', { exact: true }).fill('Valencio');
  await dialog.getByLabel('Provincia o ciudad autónoma').selectOption('46');
  await expect(dialog.getByText('No encontramos «Valencio». Revisa la ortografía.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialog.getByRole('alert')).toContainText('lista');
  await fillLocation(dialog, 'valencia', '46', /^València/);
  await dialog.getByRole('spinbutton').fill('4');
  await dialog.getByRole('checkbox', { name: /Niños y niñas/ }).check();
  await dialog.getByRole('checkbox', { name: /Medicación habitual/ }).check();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await expect(dialog.getByRole('heading', { name: '¿Cómo es tu vivienda?' })).toBeVisible();
  await dialog.getByRole('radio', { name: /Planta baja/ }).check();
  await dialog.getByRole('checkbox', { name: /Garaje, trastero o sótano/ }).check();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByLabel('Contacto principal').fill('Contacto de prueba 600000000');
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: /Terremotos/ }).click();
  await dialog.getByRole('checkbox', { name: /Entiendo que es una recomendación/ }).check();
  await page.screenshot({ path: 'test-results/wizard.png' });
  await dialog.getByRole('button', { name: 'Generar mi guía' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20000 });

  await expect(page.getByRole('heading', { name: 'Mi plan familiar', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tus prioridades' })).toBeVisible();
  const priorities = page.locator('.priorities > li');
  await expect(priorities).toHaveCount(5);
  await expect(page.locator('.priorities')).toContainText('No bajes al garaje');
  await expect(page.locator('.priorities')).toContainText('planta alta');
  await expect(page.locator('.priorities .why').first()).toContainText('Por qué para ti');
  await expect(page.locator('.chips')).toContainText('Planta baja');
  await expect(page.getByText('Contacto de prueba 600000000', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Terremotos/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Fija muebles altos');
  await expect(page.locator('.regional-recommendations').getByRole('heading', { name: 'Botiquín preparado' })).toBeVisible();
  await expect(page.getByText('Esta guía contiene recomendaciones orientativas.', { exact: false }).first()).toBeVisible();
  await page.locator('.priorities .done-toggle').first().click();
  await expect(page.locator('.priorities .done-toggle').first()).toContainText('Hecho');
  await page.screenshot({ path: 'test-results/plan-desktop.png', fullPage: true });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('a-salvo-Valencia.pdf');
  await download.saveAs('test-results/guia-valencia.pdf');
  await page.getByRole('button', { name: 'Guardar en este navegador' }).click();
  await expect(page.getByRole('button', { name: 'Guardada aquí' })).toBeDisabled();

  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mi kit de emergencia' }).click();
  await expect(page.getByText('36 litros')).toBeVisible();
  await page.getByRole('checkbox', { name: /Agua potable/ }).check();
  await page.getByRole('checkbox', { name: /Linterna y pilas/ }).check();
  await expect(page.getByText(/^2 de \d+ artículos preparados$/)).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/kit-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mi kit de emergencia' }).click();
  await expect(page.getByRole('checkbox', { name: /Agua potable/ })).toBeChecked();
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: /Mi plan familiar/ }).click();
  await expect(page.locator('.priorities .done-toggle').first()).toContainText('Hecho');
  await page.getByRole('contentinfo').getByRole('button', { name: 'Ayuda y privacidad' }).click();
  await page.getByRole('button', { name: 'Borrar mis datos locales' }).click();
  await page.getByRole('button', { name: 'Sí, borrar datos' }).click();
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: /Mi plan familiar/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu plan empieza aquí.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('móvil sin desbordamiento y con asistente navegable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await page.locator('#mobile-nav').getByRole('button', { name: 'Mi kit de emergencia' }).click();
  await expect(page.locator('#mobile-nav')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mi kit de emergencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Incluir en mi guía' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tu municipio', { exact: true }).fill('san');
  await expect(dialog.getByRole('listbox', { name: 'Sugerencias: tu municipio' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/wizard-suggestions-mobile.png' });
  await fillLocation(dialog, 'madrid', '28', /^Madrid/);
  await expect(dialog.getByRole('heading', { name: '¿Quiénes sois en casa?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/wizard-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('sin servicio de fuentes, la guía y el usuario reciben un aviso explícito', async ({ page }) => {
  test.skip(process.env.E2E_STATIC === '1', 'En GitHub Pages las fuentes se comprueban al publicar.');
  await page.route('**/api/sources/check', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: /Crear mi plan familiar/ }).first().click();
  const dialog = page.getByRole('dialog');
  await fillLocation(dialog, 'sevilla', '41', /^Sevilla/);
  for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('checkbox', { name: /Entiendo que es una recomendación/ }).check();
  await dialog.getByRole('button', { name: 'Generar mi guía' }).click();
  await expect(page.getByText(/No se han podido consultar las fuentes en esta generación/)).toBeVisible();
  await expect(page.getByText('Acceso pendiente de consulta').first()).toBeVisible();
});

test('mapa oficial: se genera solo al validar la dirección, con inundación, incendio y terremoto, y pasa al plan y al PDF', async ({ page }) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mapa de mi zona' }).click();
  await expect(page.getByText(/se genera automáticamente/)).toBeVisible();
  await pickMunicipality(page.locator('.map-location'), 'paipo', /^Paiporta/);
  await expect(page.getByLabel('Provincia o ciudad autónoma')).toHaveValue('46');
  const map = page.getByRole('region', { name: /^Mapa de inundación centrado en Paiporta/ });
  await expect(map).toBeVisible({ timeout: 25000 });
  await expect(page.getByText('Centro municipal')).toBeVisible();
  await page.getByLabel('Tu calle y número (opcional)', { exact: true }).fill('san antonio 5');
  await expect(page.getByRole('listbox').getByRole('option', { name: /Calle San Antonio 5/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('listbox').getByRole('option', { name: /Calle San Antonio 5/ }).first().click();
  await expect(page.getByText(/Dirección verificada en CartoCiudad · 46200/)).toBeVisible({ timeout: 15000 });

  const homeMap = page.getByRole('region', { name: /^Mapa de inundación centrado en tu dirección/ });
  await expect(homeMap).toBeVisible({ timeout: 25000 });
  await expect(homeMap.getByText('Tu dirección')).toBeVisible();
  const result = page.locator('.point-result');
  await expect(result).toContainText('Terremoto · IGN', { timeout: 30000 });
  await expect(result).toContainText(/\b(IV|V|VI|VII|VIII) · |Sin datos/);
  await expect(result).toContainText('Incorporado automáticamente a tu plan');
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30000 });
  await page.screenshot({ path: 'test-results/map-desktop.png', fullPage: true });

  const tabs = page.getByRole('tablist', { name: 'Peligro que se muestra en el mapa' });
  await tabs.getByRole('tab', { name: /Terremoto/ }).click();
  await expect(page.getByRole('region', { name: /^Mapa de terremoto/ })).toBeVisible();
  await expect(page.locator('.map-legend')).toContainText('VI · Levemente dañino');
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30000 });
  await page.screenshot({ path: 'test-results/map-seismic.png' });
  await tabs.getByRole('tab', { name: /Incendio/ }).click();
  await expect(page.locator('.map-legend')).toContainText('Peligro meteorológico de incendio');
  await tabs.getByRole('tab', { name: /Inundación/ }).click();

  const box = await homeMap.boundingBox();
  await homeMap.click({ position: { x: box!.width * .25, y: box!.height * .3 } });
  await expect(result).toContainText('Punto marcado', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Usar este punto en mi plan' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Volver a mi dirección' }).click();
  await expect(result).toContainText('Incorporado automáticamente a tu plan');

  const mapDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar mapa' }).click();
  await (await mapDownload).saveAs('test-results/mapa-paiporta.png');
  await expect(page.getByText(/Mapa descargado/)).toBeVisible({ timeout: 60000 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/map-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page.getByRole('button', { name: 'Crear mi plan con esta ubicación' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Tu municipio', { exact: true })).toHaveValue('Paiporta');
  await expect(dialog.getByRole('tablist', { name: 'Peligro que se muestra en el mapa' })).toBeVisible({ timeout: 25000 });
  await expect(dialog.locator('.point-result')).toContainText('Incorporado automáticamente a tu plan');
  await page.screenshot({ path: 'test-results/wizard-map.png' });
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('checkbox', { name: /Entiendo que es una recomendación/ }).check();
  await dialog.getByRole('button', { name: 'Generar mi guía' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Peligros oficiales en tu dirección' })).toBeVisible();
  await expect(page.locator('.point-card .point-result')).toContainText('Terremoto · IGN', { timeout: 25000 });
  await page.screenshot({ path: 'test-results/plan-with-point.png', fullPage: true });
  const pdfDownload = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
  await (await pdfDownload).saveAs('test-results/guia-con-mapa.pdf');
  const pdf = await readFile('test-results/guia-con-mapa.pdf');
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  expect(errors).toEqual([]);
});

test('navegación: URL por sección, atrás del navegador, volver desde el mapa y número de portal', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver el mapa de mi zona' }).click();
  await expect(page).toHaveURL(/#mapa$/);
  await expect(page.getByRole('heading', { name: 'Mapa de mi zona', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Tu municipio', { exact: true })).toHaveAttribute('placeholder', 'Escribe el nombre de tu municipio');

  await pickMunicipality(page.locator('.map-location'), 'canet d', /^Canet d'En Berenguer/);
  const street = page.getByLabel('Tu calle y número (opcional)', { exact: true });
  await street.fill('jose segrelles');
  await page.getByRole('listbox').getByRole('option', { name: /Calle Jose Segrelles/ }).first().click();
  await expect(page.getByText(/Calle verificada\. Añade el número/)).toBeVisible({ timeout: 15000 });
  await street.pressSequentially('5', { delay: 60 });
  await page.getByRole('listbox').getByRole('option', { name: /^Calle Jose Segrelles 5\b/ }).first().click({ timeout: 20000 });
  await expect(street).toHaveValue('Calle Jose Segrelles 5');
  await expect(page.getByText(/Dirección verificada en CartoCiudad · 46529/)).toBeVisible({ timeout: 15000 });

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sabe qué hacer');
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Mapa de mi zona', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Volver al inicio' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sabe qué hacer');

  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: /Mi plan familiar/ }).click();
  await expect(page).toHaveURL(/#plan$/);
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Mapa de mi zona' }).click();
  await expect(page.getByRole('button', { name: 'Volver a mi guía' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Crear mi plan con esta ubicación' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Tu municipio', { exact: true })).toHaveValue("Canet d'En Berenguer");
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/#plan$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mi plan familiar', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Saltar al contenido' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#plan$/);
  await expect(page.getByRole('heading', { name: 'Mi plan familiar', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

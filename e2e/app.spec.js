// End-to-End: das Desktop-Programm (Electron) mit simuliertem SECUTEST, so wie ein Prüfer es bedient.
const { test, expect, _electron: electron } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'dist', 'e2e-screenshots');
// SECUTEST_E2E_APP=<Programmdatei>: dieselben Tests gegen das fertig gepackte Programm statt gegen den Quellcode
const PACKAGED = process.env.SECUTEST_E2E_APP || null;
const appArgs = (extra) => (PACKAGED ? extra : [ROOT, ...extra]);

/** Programm mit eigenem Daten- und Programmordner starten (stört ein laufendes echtes Programm nicht) */
async function launch(dir, extraArgs = []) {
  const env = { ...process.env, SECUTEST_HOME: path.join(dir, 'home'), SECUTEST_USER_DATA: path.join(dir, 'electron'), SECUTEST_DESKTOP_PORT: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(PACKAGED ? { executablePath: PACKAGED } : {}), args: appArgs(['--simulator', ...extraArgs]), env });
  const page = await app.firstWindow();
  return { app, page, env };
}

/** API-Aufruf aus dem Programmfenster (mit Kennung des Serverstarts wie die Oberfläche) */
const api = (page, method, p, body) =>
  page.evaluate(
    async ([method, p, body]) => {
      const { boot } = await fetch('/api/status').then((r) => r.json());
      const r = await fetch(`/api${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest', 'X-UI-Boot': boot }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, p, body]
  );

/** Datenbank ohne Passwort, ein SK-II-Gerät, Simulator „SK II in Ordnung“ */
async function prepare(page, dir) {
  await page.waitForLoadState('domcontentloaded');
  expect((await api(page, 'POST', '/disclaimer/accept', {})).status).toBe(200);
  expect((await api(page, 'POST', '/setup/begin', { name: 'E2E Test', folder: path.join(dir, 'db'), usePassword: false, twoFactor: false })).status).toBe(200);
  const dev = await api(page, 'POST', '/devices', { name: 'Netzteil SK II', protection_class: 'SK II', inventory_no: 'E2E-1', device_type: 'standard' });
  expect(dev.status).toBe(201);
  expect((await api(page, 'POST', '/secutest/scenario', { scenario: 'sk2-ok' })).status).toBe(200);
  return dev.body.id;
}

const stepTitle = (page) => page.locator('.card.stack h2').first();

test('Desktop-Programm: automatische SK-II-Prüfung, Funktionstest von Hand, Speichern', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-e2e-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  const { app, page } = await launch(dir);
  try {
    expect(await page.title()).toContain('Prüfmanager');
    const deviceId = await prepare(page, dir);
    await page.evaluate((id) => (location.hash = `#/inspect?device=${id}`), deviceId);
    await page.reload();

    await page.locator('.choice', { hasText: 'PC-gesteuert' }).click();
    await page.locator('.choice', { hasText: 'Schutzklasse II' }).click();
    await page.getByRole('button', { name: /Prüfung starten/ }).click();
    await expect(page.getByText('⚙ Automatik an')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '1-vorbereitung.png') });

    // Vorbereitung: Anschlusskontrolle, danach automatisch zur Sichtprüfung
    await page.getByRole('button', { name: /Automatische Prüfung starten/ }).click();
    await expect(stepTitle(page)).toContainText('Sichtprüfung', { timeout: 30_000 });
    await page.getByRole('button', { name: /Alle in Ordnung/ }).click();
    await page.getByRole('button', { name: /^Weiter/ }).click();

    // vor der ersten Messung mit Prüfspannung einmal „Hände weg“ bestätigen, danach ohne Klick
    await expect(stepTitle(page)).toContainText('Isolationswiderstand');
    await page.getByRole('button', { name: /Hände weg – Messungen starten/ }).click();
    // R_ISO und I_B: messen, eintragen, weiterschalten – ohne Klick
    await expect(page.getByText('Messung läuft')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOTS, '2-riso-automatik.png') });
    await expect(stepTitle(page)).toContainText('Berührungsstrom', { timeout: 40_000 });
    await expect(stepTitle(page)).toContainText('Funktionstest', { timeout: 40_000 });

    // Funktionstest am SECUTEST (simulierte Taste 14), Werte per Knopf
    await expect(page.getByText('Funktionstest bitte am SECUTEST durchführen')).toBeVisible();
    await expect(page.getByText(/Funktionstest läuft gerade nicht/)).toBeVisible({ timeout: 15_000 });
    expect((await api(page, 'POST', '/secutest/key', { key: 'FUNCTION_TEST' })).status).toBe(200);
    await expect(page.getByText(/Funktionstest läuft – „📥/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Werte vom SECUTEST übernehmen/ }).click();
    await expect(page.locator('.card.stack .grid input').first()).not.toHaveValue('');
    await page.screenshot({ path: path.join(SHOTS, '3-funktionstest.png') });
    await page.getByRole('button', { name: /Alle in Ordnung/ }).click();

    // noch nicht beendet: Erinnerung; nach dem Beenden am Gerät ohne Rückfrage weiter
    await page.getByRole('button', { name: /^Weiter/ }).click();
    await expect(page.getByText('Funktionstest noch aktiv')).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Abbrechen' }).click();
    expect((await api(page, 'POST', '/secutest/key', { key: 'FUNCTION_TEST' })).status).toBe(200);
    await expect(page.getByText(/Funktionstest läuft gerade nicht/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Weiter/ }).click();

    // Bewertung und Speichern
    await expect(stepTitle(page)).toContainText('Bewertung');
    await expect(page.getByText('BESTANDEN', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '4-bewertung.png') });
    await page.getByRole('button', { name: /Prüfung speichern/ }).click();
    const inspections = await api(page, 'GET', `/devices/${deviceId}`);
    await expect.poll(async () => (await api(page, 'GET', `/devices/${deviceId}`)).body?.inspections?.length).toBe(1);
    expect(inspections.status).toBe(200);

    // Prüfprotokoll öffnet sich in einem eigenen Programmfenster (nicht im Browser) mit Druckknopf
    const [report] = await Promise.all([app.waitForEvent('window'), page.getByRole('link', { name: /Prüfprotokoll/ }).click()]);
    await report.waitForLoadState('domcontentloaded');
    await expect(report.getByRole('button', { name: /Drucken/ })).toBeVisible();
    await expect(report.locator('body')).toContainText('Netzteil SK II');
    await report.screenshot({ path: path.join(SHOTS, '5-pruefprotokoll.png') });
    await report.close();
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('Desktop-Programm: nur eine Instanz, Fenster schließen beendet das Programm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secutest-e2e-'));
  const { app, page, env } = await launch(dir);
  try {
    await page.waitForLoadState('domcontentloaded');
    // zweiter Start mit demselben Programmordner beendet sich sofort (das vorhandene Fenster kommt nach vorn)
    const second = spawn(PACKAGED || require('electron'), appArgs(['--simulator']), { env, stdio: 'ignore' });
    const code = await new Promise((r) => second.on('exit', r));
    expect(code).toBe(0);
    expect(app.windows().length).toBe(1);
    // Fenster schließen → Programm endet
    const closed = new Promise((r) => app.process().on('exit', r));
    await page.close();
    await closed;
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import type { Session } from './types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function cachePath(): string {
  return process.env.SESSION_CACHE || join(process.cwd(), '.session-cache.json');
}

function loadCachedSession(): Session | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    if (data.cookies && data.csrftoken && data.userid) return data as Session;
  } catch {}
  return null;
}

function saveSession(s: Session): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(s, null, 2));
  } catch {}
}

async function testSession(s: Session): Promise<boolean> {
  try {
    const res = await fetch('https://cloud.hihonor.com/findmydevice/api/html/getHomeData', {
      method: 'POST',
      headers: {
        'Cookie': s.cookies,
        'csrftoken': s.csrftoken,
        'content-type': 'application/json;charset=UTF-8',
        'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
        'User-Agent': UA,
      },
      body: JSON.stringify({ traceId: `test_${Date.now()}`, lang: '' }),
    });
    const data = await res.json();
    return !!data.userid;
  } catch {
    return false;
  }
}

async function doLogin(phone: string, password: string): Promise<Session> {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'zh-CN',
    });
    const page = await context.newPage();

    await page.goto('https://cloud.hihonor.com/findmydevice/webFindOpenPage.html', {
      waitUntil: 'networkidle',
    });

    const loginBtn = page.getByText('立即登录').first();
    await loginBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loginBtn.click();

    await page.waitForURL('**/loginAuth.html**', { timeout: 20000 });
    await page.waitForTimeout(2000);

    const phoneInput = page.locator('input[type="text"]').first();
    await phoneInput.waitFor({ state: 'visible', timeout: 10000 });
    await phoneInput.fill(phone);

    const pwdInput = page.locator('input[type="password"]').first();
    await pwdInput.fill(password);

    const submitBtn = page.locator('button[type="submit"]').first();
    const submitVisible = await submitBtn.isVisible().catch(() => false);
    if (submitVisible) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForURL('**/webFindPhone.html**', { timeout: 30000 });

    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const csrftoken = cookies.find(c => c.name === 'CSRFToken')?.value || '';

    const homeRes = await fetch('https://cloud.hihonor.com/findmydevice/api/html/getHomeData', {
      method: 'POST',
      headers: {
        'Cookie': cookieStr,
        'csrftoken': csrftoken,
        'content-type': 'application/json;charset=UTF-8',
        'Referer': 'https://cloud.hihonor.com/findmydevice/webFindPhone.html',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        traceId: `00001_02_${Date.now()}_${Math.random().toString().slice(2, 10)}`,
        lang: '',
      }),
    });
    const homeData = await homeRes.json();
    const userid = homeData.userid ?? '';
    const amapKey = homeData.amapUrl?.match(/key=([^&]+)/)?.[1] ?? 'dfcb19382b3e7e64c93f276b9eae7fbd';

    return { cookies: cookieStr, csrftoken, userid, amapKey };
  } finally {
    await browser.close();
  }
}

export async function loginViaHttp(phone: string, password: string): Promise<Session> {
  const cached = loadCachedSession();
  if (cached) {
    const valid = await testSession(cached);
    if (valid) {
      console.log('  使用缓存的 session');
      return cached;
    }
    console.log('  session 已过期，重新登录');
  }

  const session = await doLogin(phone, password);
  saveSession(session);
  return session;
}

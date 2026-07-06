import { chromium, type Page, type BrowserContext } from 'playwright';
import { handleAgreement } from './login-http.js';

export interface Session {
  context: BrowserContext;
  page: Page;
  csrftoken: string;
  userid: string;
  amapKey: string;
}

export async function login(
  phone: string,
  password: string,
  headless = false,
): Promise<Session> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  // 打开查找设备页面
  await page.goto(
    'https://cloud.hihonor.com/findmydevice/webFindOpenPage.html#/',
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );

  // 处理 Cookie 提示（如果有）
  try {
    const cookieNotice = page.locator('text=了解更多');
    if (await cookieNotice.isVisible({ timeout: 2000 })) {
      await page.locator('text=我知道了').or(page.locator('text=同意')).first().click({ timeout: 1000 });
    }
  } catch { /* no cookie banner */ }

  // 点击"立即登录"
  await page.locator('text=立即登录').click();
  await page.waitForURL('**/loginAuth.html**', { timeout: 15000 });

  // 等待登录表单加载
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // 填写账号密码（逐个字符输入，确保触发所有事件）
  const accountInput = page.locator('input[type="text"]').first();
  await accountInput.click();
  await accountInput.fill(phone);

  const pwdInput = page.locator('input[type="password"]').first();
  await pwdInput.click();
  await pwdInput.fill(password);

  await page.waitForTimeout(800);

  // 方式1: 按 Enter 提交（最可靠）
  await pwdInput.press('Enter');

  await handleAgreement(page);

  // 等待跳转到查找设备主页
  try {
    await page.waitForURL('**/webFindPhone.html**', { timeout: 15000 });
  } catch {
    // Enter 没生效，尝试点击按钮
    const loginBtn = page.locator('span:has-text("登录")').last();
    await loginBtn.click();
    await handleAgreement(page);
    await page.waitForURL('**/webFindPhone.html**', { timeout: 15000 });
  }

  await page.waitForURL('**/webFindPhone.html**', { timeout: 20000 });

  await page.waitForTimeout(2000);

  // 提取 csrftoken
  const cookies = await context.cookies();
  const csrfCookie = cookies.find(c => c.name === 'CSRFToken');
  const csrftoken = csrfCookie?.value ?? '';

  // 从 getHomeData 获取 userid 和 amapKey
  const homeResp = await page.request.post(
    'https://cloud.hihonor.com/findmydevice/api/html/getHomeData',
    {
      headers: {
        'csrftoken': csrftoken,
        'content-type': 'application/json;charset=UTF-8',
      },
      data: {
        traceId: `00001_02_${Date.now()}_${Math.random().toString().slice(2, 10)}`,
        lang: '',
      },
    },
  );
  const homeData = await homeResp.json();
  const userid = homeData.userid ?? '';
  const amapKey = homeData.amapUrl?.match(/key=([^&]+)/)?.[1] ?? '';

  // 尝试多个 amap key（getHomeData 的 JS API key 可能和 regeo key 不同）
  const amapKeys = [amapKey, 'dfcb19382b3e7e64c93f276b9eae7fbd'].filter(Boolean);

  return { context, page, csrftoken, userid, amapKey: amapKeys[0] };
}

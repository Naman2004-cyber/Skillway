const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
  page.on('requestfailed', request => console.log('BROWSER NETWORK FAILED:', request.url(), request.failure().errorText));
  page.on('response', response => {
      if (!response.ok() && response.url().includes('/api/')) {
          console.log('BROWSER API ERROR:', response.url(), response.status());
      }
  });

  await page.goto('http://localhost:4000/auth/index.html');
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', 'namanunacademy2004@gmail.com');
  await page.type('input[type="password"]', 'naman_2004');
  await page.click('button[type="submit"]');
  
  await page.waitForNavigation();
  await page.goto('http://localhost:4000/student/index.html#chat');
  await page.waitForSelector('#btn-new-chat', { visible: true });
  await page.click('#btn-new-chat');
  
  await page.waitForSelector('.sw-chat-user-row', { visible: true });
  await page.click('.sw-chat-user-row');
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();

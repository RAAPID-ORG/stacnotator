import base from './playwright.config';
export default { ...base, projects: [{ name: 'chromium', use: { ...base.projects![0].use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } }] };

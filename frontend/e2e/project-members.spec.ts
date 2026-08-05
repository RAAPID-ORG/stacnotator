import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_PROJECT, MOCK_PROJECT_USERS } from './fixtures/mock-data';

const KNOWN = {
  id: 'ada-user',
  email: 'ada@example.org',
  display_name: 'Ada Lovelace',
  is_admin: false,
  issuer: 'firebase',
};
const UNKNOWN_EMAIL = 'nobody@example.org';

const membersUrl = `/projects/${MOCK_PROJECT.id}?tab=members`;

test.describe('Project members', () => {
  test('the members tab lists the project members', async ({ appPage }) => {
    await Promise.all([appPage.waitForResponse(ROUTE.projectUsers), appPage.goto(membersUrl)]);

    await expect(appPage.getByTestId('project-member-row')).toHaveCount(
      MOCK_PROJECT_USERS.users.length
    );
    await expect(appPage.getByTestId('project-member-row')).toContainText(
      MOCK_PROJECT_USERS.users.map((member) => member.user.email)
    );
  });

  test('adding by email adds the known address and reports the unknown one', async ({
    appPage,
  }) => {
    // The member list grows once the add succeeds, mirroring the backend refetch.
    let members = MOCK_PROJECT_USERS.users;
    const posted: { emails?: string[] }[] = [];

    await appPage.route(ROUTE.projectUsers, async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { ...MOCK_PROJECT_USERS, users: members } });
      }
      if (route.request().method() !== 'POST') return route.fallback();
      posted.push(route.request().postDataJSON());
      members = [...members, { user: KNOWN, is_admin: false, is_authoritative_reviewer: false }];
      await route.fulfill({
        json: { added: [KNOWN], unknown_emails: [UNKNOWN_EMAIL] },
      });
    });

    await Promise.all([appPage.waitForResponse(ROUTE.projectUsers), appPage.goto(membersUrl)]);

    await appPage.getByTestId('member-emails-input').fill(`${KNOWN.email}, ${UNKNOWN_EMAIL}`);
    await Promise.all([
      appPage.waitForResponse(
        (response) =>
          ROUTE.projectUsers.test(response.url()) && response.request().method() === 'POST'
      ),
      appPage.getByTestId('member-emails-submit').click(),
    ]);

    expect(posted).toHaveLength(1);
    expect(posted[0].emails).toEqual([KNOWN.email, UNKNOWN_EMAIL]);

    await expect(appPage.getByTestId('add-result-added')).toContainText(KNOWN.email);
    await expect(appPage.getByTestId('add-result-unknown')).toContainText(UNKNOWN_EMAIL);
    await expect(appPage.getByTestId('project-member-row')).toHaveCount(
      MOCK_PROJECT_USERS.users.length + 1
    );
  });

  test('removing a member asks for confirmation first', async ({ appPage }) => {
    const [staying, leaving] = MOCK_PROJECT_USERS.users;
    let members = MOCK_PROJECT_USERS.users;

    await appPage.route(ROUTE.projectUsers, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: { ...MOCK_PROJECT_USERS, users: members } });
    });
    await appPage.route(/\/api\/projects\/\d+\/users\/[^/]+$/, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      members = members.filter((member) => !route.request().url().endsWith(member.user.id));
      await route.fulfill({ json: {} });
    });

    await Promise.all([appPage.waitForResponse(ROUTE.projectUsers), appPage.goto(membersUrl)]);

    const row = appPage.getByTestId('project-member-row').filter({ hasText: leaving.user.email });

    appPage.once('dialog', (dialog) => dialog.dismiss());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(appPage.getByTestId('project-member-row')).toHaveCount(
      MOCK_PROJECT_USERS.users.length
    );

    appPage.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Remove' }).click();

    await expect(appPage.getByTestId('project-member-row')).toHaveCount(1);
    await expect(appPage.getByTestId('project-member-row')).toContainText(staying.user.email);
  });
});

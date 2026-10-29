import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddUsersByEmailResult } from '~/api/client';
import { Button, Field, Textarea } from '~/shared/ui/forms';
import { parseEmailList } from '~/shared/utils/utility';
import { inviteSignupNote } from './PendingInvites';

interface AddByEmailProps {
  /** Adds the addresses to the organization or project; resolves with who joined
   *  and who was invited, rejects when the request failed (the caller reports). */
  onAdd: (emails: string[]) => Promise<AddUsersByEmailResult>;
}

/** Add people to an organization or a project by email address. Addresses with
 *  an account join now; the others wait as invites until they sign up. */
export const AddByEmail = ({ onAdd }: AddByEmailProps) => {
  const { t } = useTranslation('members');
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<AddUsersByEmailResult | null>(null);
  const [malformed, setMalformed] = useState<string[]>([]);

  const submit = async () => {
    const { emails, invalid } = parseEmailList(text);
    setMalformed(invalid);
    setResult(null);
    if (emails.length === 0) return;
    setAdding(true);
    try {
      setResult(await onAdd(emails));
      setText('');
    } catch {
      // Reported by the caller's mutation.
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field label={t('byEmail.label')} htmlFor="member-emails-input">
        <Textarea
          id="member-emails-input"
          data-testid="member-emails-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('byEmail.placeholder')}
          disabled={adding}
        />
      </Field>
      <Button
        data-testid="member-emails-submit"
        onClick={() => void submit()}
        disabled={adding || text.trim() === ''}
      >
        {adding ? t('byEmail.adding') : t('byEmail.submit')}
      </Button>
      {(malformed.length > 0 || result) && (
        <div className="space-y-2 text-xs">
          {malformed.length > 0 && (
            <div
              data-testid="add-result-malformed"
              className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700"
            >
              {t('byEmail.malformed', { emails: malformed.join(', ') })}
            </div>
          )}
          {result && result.added.length > 0 && (
            <div
              data-testid="add-result-added"
              className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-800"
            >
              {t('byEmail.added', {
                count: result.added.length,
                list: result.added.map((u) => u.email ?? u.display_name).join(', '),
              })}
            </div>
          )}
          {result && result.invited_emails.length > 0 && (
            <div
              data-testid="add-result-invited"
              className="px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-brand-800"
            >
              {t('byEmail.invited', {
                emails: result.invited_emails.join(', '),
                note: inviteSignupNote(),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

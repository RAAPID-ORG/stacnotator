import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeySourcePicker } from './KeySourcePicker';

const keys = [
  { id: 11, name: 'Planet NICFI' },
  { id: 12, name: 'Planet Scenes' },
] as Parameters<typeof KeySourcePicker>[0]['orgKeys'];

const picker = (props: Partial<Parameters<typeof KeySourcePicker>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <KeySourcePicker
      label="Provider API key"
      explainer="why"
      orgKeys={[]}
      organizationApiKeyId={null}
      onChange={onChange}
      {...props}
    />
  );
  return onChange;
};

describe('KeySourcePicker', () => {
  it('asks for the read-only confirmation only once there is a key to confirm', async () => {
    const onChange = picker();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await userEvent.type(screen.getByLabelText('Provider API key'), 'abc');
    expect(onChange).toHaveBeenLastCalledWith({ organizationApiKeyId: null, apiKey: undefined });

    await userEvent.click(screen.getByRole('checkbox', { name: /read-only/ }));
    expect(onChange).toHaveBeenLastCalledWith({ organizationApiKeyId: null, apiKey: 'abc' });
  });

  it("offers the organization's keys as a choice beside the key of its own", async () => {
    const onChange = picker({ orgKeys: keys, organizationApiKeyId: 11 });

    await userEvent.selectOptions(screen.getByTestId('org-key-select'), '12');
    expect(onChange).toHaveBeenLastCalledWith({ organizationApiKeyId: 12 });

    await userEvent.click(screen.getByRole('radio', { name: /Own key/ }));
    expect(onChange).toHaveBeenLastCalledWith({ organizationApiKeyId: null, apiKey: undefined });
  });
});

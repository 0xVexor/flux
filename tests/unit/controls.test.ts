import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select } from '../../src/ui/components/Select';
import { DateTimePicker } from '../../src/ui/components/DateTimePicker';

const priority = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    h(
      Select,
      { name: 'priority', 'aria-label': 'Priority', ...props },
      h('option', { value: '2' }, 'High'),
      h('option', { value: '0' }, 'Normal'),
      h('option', { value: '-2' }, 'Low'),
    ),
  );

describe('Select', () => {
  it('shows the chosen option and submits its value with the form', () => {
    const html = priority({ defaultValue: '-2' });
    expect(html).toContain('>Low<');
    expect(html).toContain('name="priority" value="-2"');
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('role="listbox"');
  });
  it('falls back to the first option when the value matches nothing', () => {
    expect(priority({ value: 'missing' })).toContain('>High<');
  });
  it('reads option groups and plain options alike', () => {
    const html = renderToStaticMarkup(
      h(
        Select,
        { defaultValue: 'Compressed' },
        h('option', { value: '' }, 'Automatic'),
        h(
          'optgroup',
          { label: 'Main folders' },
          h('option', { value: 'Compressed' }, 'Compressed'),
        ),
      ),
    );
    expect(html).toContain('>Compressed<');
  });
});

describe('DateTimePicker', () => {
  it('shows a readable date and keeps the machine value in a hidden field', () => {
    const html = renderToStaticMarkup(
      h(DateTimePicker, { name: 'schedule', defaultValue: '2026-11-09T09:30' }),
    );
    expect(html).toContain('name="schedule" value="2026-11-09T09:30"');
    expect(html).toContain('2026');
    expect(html).not.toContain('Pick date and time');
  });
  it('asks for a date when there is none', () => {
    expect(renderToStaticMarkup(h(DateTimePicker, { name: 'schedule' }))).toContain(
      'Pick date and time',
    );
  });
});

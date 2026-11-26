import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Dropdown, type DropdownOption } from './dropdown';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const options = (n: number): DropdownOption[] => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));

function Harness(props: { count: number; initial?: string; required?: boolean }) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <>
      <Dropdown label="Region" value={value} options={options(props.count)} onChange={setValue} required={props.required} placeholder="Choose" />
    </>
  );
}

const open = async () => {
  await fireEvent.press(screen.getByLabelText('Region'));
  // The dropdown opens as soon as it knows where the field is, or after a moment if it cannot find out.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
  });
};

describe('Dropdown', () => {
  test('shows what is chosen, or the placeholder', async () => {
    await render(<Harness count={4} initial="v2" />);
    expect(screen.getByText('Option 2')).toBeTruthy();
    await render(<Harness count={4} />);
    expect(screen.getByText('Choose')).toBeTruthy();
  });

  test('a short list drops down, choosing one closes it and shows it in the field', async () => {
    await render(<Harness count={4} />);
    await open();
    expect(screen.getByText('Option 3')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull();
    await fireEvent.press(screen.getByText('Option 3'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(screen.queryByText('Option 0')).toBeNull();
    expect(screen.getByText('Option 3')).toBeTruthy();
  });

  test('a long list opens as a sheet with search that narrows it', async () => {
    await render(<Harness count={30} />);
    await open();
    const search = screen.getByPlaceholderText('Search 30 options');
    await fireEvent.changeText(search, 'option 29');
    expect(screen.getByText('Option 29')).toBeTruthy();
    expect(screen.queryByText('Option 5')).toBeNull();
    expect(screen.queryByText('Option 2')).toBeNull();
    await fireEvent.changeText(search, 'zzz');
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  test('an optional choice can be cleared, a required one cannot', async () => {
    await render(<Harness count={4} initial="v1" />);
    await open();
    expect(screen.getByText('Clear choice')).toBeTruthy();
  });

  test('a required choice offers no clear', async () => {
    await render(<Harness count={4} initial="v1" required />);
    await open();
    expect(screen.queryByText('Clear choice')).toBeNull();
  });
});

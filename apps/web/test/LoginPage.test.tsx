import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { LoginPage } from '../src/components/LoginPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('signs in with the entered email and password', async () => {
    const login = vi.spyOn(api, 'login').mockResolvedValue({ authenticated: true, email: 'me@example.com' });
    const onLoggedIn = vi.fn();
    render(<LoginPage onLoggedIn={onLoggedIn} />);
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    fill('me@example.com', 'secret-pw');
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith('me@example.com'));
    expect(login).toHaveBeenCalledWith('me@example.com', 'secret-pw');
  });

  it('shows the server error for wrong credentials and clears the password', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('Invalid email or password'));
    const onLoggedIn = vi.fn();
    render(<LoginPage onLoggedIn={onLoggedIn} />);
    fill('me@example.com', 'wrong');
    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it('disables Sign in until both fields are filled', () => {
    render(<LoginPage onLoggedIn={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    expect(button.disabled).toBe(false);
  });
});

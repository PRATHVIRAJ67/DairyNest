import { fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { supabase } from '@/lib/supabase';
import OtpScreen from '../app/(auth)/otp';
import PhoneScreen from '../app/(auth)/phone';
import ProfileSetup from '../app/(auth)/profile-setup';
import { params, renderWithProviders, router } from '../test-support/testUtils';

const auth = supabase.auth as unknown as { signInWithOtp: jest.Mock; verifyOtp: jest.Mock };

describe('phone sign-in', () => {
  beforeEach(() => auth.signInWithOtp.mockReset());

  it('rejects an invalid number without calling Supabase', async () => {
    const { getByTestId, findByText } = await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(getByTestId('phone-input'), '12345');
    await fireEvent.press(getByTestId('phone-submit'));
    expect(await findByText('Enter a valid 10-digit mobile number')).toBeTruthy();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('strips non-digits and rejects numbers not starting with 6-9', async () => {
    const { getByTestId, findByText } = await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(getByTestId('phone-input'), '1234567890');
    await fireEvent.press(getByTestId('phone-submit'));
    expect(await findByText('Enter a valid 10-digit mobile number')).toBeTruthy();
  });

  it('requests a real OTP for +91 and moves to verification', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    const { getByTestId } = await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(getByTestId('phone-input'), '98765 43210');
    await fireEvent.press(getByTestId('phone-submit'));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+919876543210' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(auth)/otp', params: { phone: '+919876543210' } });
  });

  it('shows an honest message when the SMS provider is not configured', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: { message: 'Unsupported phone provider' } });
    const { getByTestId, findByText } = await renderWithProviders(<PhoneScreen />);
    await fireEvent.changeText(getByTestId('phone-input'), '9876543210');
    await fireEvent.press(getByTestId('phone-submit'));
    expect(await findByText(/SMS sending is not set up/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('OTP verification', () => {
  beforeEach(() => { auth.verifyOtp.mockReset(); params.phone = '+919876543210'; });

  it('keeps the button disabled until 6 digits are entered', async () => {
    const { getByTestId } = await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(getByTestId('otp-input'), '123');
    expect(getByTestId('otp-submit').props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(getByTestId('otp-input'), '123456');
    expect(getByTestId('otp-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('verifies with Supabase and returns to the gate on success', async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    const { getByTestId } = await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(getByTestId('otp-input'), '123456');
    await fireEvent.press(getByTestId('otp-submit'));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: '+919876543210', token: '123456', type: 'sms' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('shows an error for a wrong or expired code and does not navigate', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const { getByTestId, findByText } = await renderWithProviders(<OtpScreen />);
    await fireEvent.changeText(getByTestId('otp-input'), '000000');
    await fireEvent.press(getByTestId('otp-submit'));
    expect(await findByText(/incorrect or has expired/)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('profile setup form', () => {
  it('requires a name and a valid optional email', async () => {
    const { getByTestId, findByText } = await renderWithProviders(<ProfileSetup />);
    await fireEvent.changeText(getByTestId('name-input'), 'A');
    await fireEvent.changeText(getByTestId('email-input'), 'not-an-email');
    await fireEvent.press(getByTestId('profile-submit'));
    expect(await findByText('Enter your name')).toBeTruthy();
    expect(await findByText('Enter a valid email')).toBeTruthy();
  });
});

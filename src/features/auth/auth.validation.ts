const USERNAME_PATTERN = /^[A-Za-zÇĞİÖŞÜçğıöşü0-9]+(?:[._][A-Za-zÇĞİÖŞÜçğıöşü0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(value: string): string | null {
  const username = value.trim();
  if (username.length < 3 || username.length > 30 || !USERNAME_PATTERN.test(username)) {
    return 'Kullanıcı adı 3–30 karakter olmalı; yalnız harf, sayı, nokta ve alt çizgi içermelidir.';
  }
  return null;
}

export function validateEmail(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim().toLowerCase())
    ? null
    : 'Geçerli bir e-posta adresi girin.';
}

export function validatePassword(value: string): string | null {
  return value.length >= 6 ? null : 'Şifre en az 6 karakter olmalıdır.';
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  return password === confirmation ? null : 'Şifreler eşleşmiyor.';
}

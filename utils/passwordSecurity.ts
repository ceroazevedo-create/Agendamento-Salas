export interface PasswordRules {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export interface PasswordStrength {
  score: number; // 0 to 4
  label: 'Muito Fraca' | 'Fraca' | 'Média' | 'Boa' | 'Forte';
  color: string;
  bgColor: string;
  borderColor: string;
  rules: PasswordRules;
  isValid: boolean;
}

export const checkPasswordStrength = (password: string): PasswordStrength => {
  const rules: PasswordRules = {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };

  if (!password) {
    return {
      score: 0,
      label: 'Muito Fraca',
      color: 'text-gray-400',
      bgColor: 'bg-gray-200',
      borderColor: 'border-gray-200',
      rules,
      isValid: false
    };
  }

  let passedCount = 0;
  if (rules.minLength) passedCount++;
  if (rules.hasUpper) passedCount++;
  if (rules.hasLower) passedCount++;
  if (rules.hasNumber) passedCount++;
  if (rules.hasSpecial) passedCount++;

  let score = 0;
  let label: PasswordStrength['label'] = 'Muito Fraca';
  let color = 'text-red-500';
  let bgColor = 'bg-red-500';
  let borderColor = 'border-red-300';

  if (passedCount <= 1 || password.length < 6) {
    score = 1;
    label = 'Fraca';
    color = 'text-red-500';
    bgColor = 'bg-red-500';
    borderColor = 'border-red-300';
  } else if (passedCount === 2 || passedCount === 3) {
    score = 2;
    label = 'Média';
    color = 'text-amber-500';
    bgColor = 'bg-amber-500';
    borderColor = 'border-amber-300';
  } else if (passedCount === 4) {
    score = 3;
    label = 'Boa';
    color = 'text-teal-600';
    bgColor = 'bg-teal-500';
    borderColor = 'border-teal-300';
  } else {
    score = 4;
    label = 'Forte';
    color = 'text-emerald-600';
    bgColor = 'bg-emerald-500';
    borderColor = 'border-emerald-300';
  }

  // Senha segura válida: pelo menos 8 caracteres, letras maiúsculas/minúsculas e pelo menos um número ou símbolo
  const isValid = rules.minLength && rules.hasUpper && rules.hasLower && (rules.hasNumber || rules.hasSpecial);

  return {
    score,
    label,
    color,
    bgColor,
    borderColor,
    rules,
    isValid
  };
};

export const getPasswordValidationMessage = (password: string): string | null => {
  const strength = checkPasswordStrength(password);
  if (!strength.rules.minLength) {
    return 'A senha deve conter no mínimo 8 caracteres.';
  }
  if (!strength.rules.hasUpper) {
    return 'A senha deve conter pelo menos uma letra maiúscula (A-Z).';
  }
  if (!strength.rules.hasLower) {
    return 'A senha deve conter pelo menos uma letra minúscula (a-z).';
  }
  if (!strength.rules.hasNumber && !strength.rules.hasSpecial) {
    return 'A senha deve conter pelo menos um número ou símbolo especial.';
  }
  return null;
};

import React, { useState } from 'react';
import { Eye, EyeOff, Check, X, ShieldCheck, ShieldAlert } from 'lucide-react';
import { checkPasswordStrength } from '../utils/passwordSecurity';

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  showStrengthMeter?: boolean;
  helperText?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  label,
  value,
  onChange,
  error,
  showStrengthMeter = false,
  helperText,
  className = '',
  placeholder = '••••••••',
  id,
  required,
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const strength = checkPasswordStrength(value);
  const inputId = id || `password-input-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className={`mb-4 ${className}`}>
      <div className="flex items-center justify-between mb-1.5 ml-1">
        <label htmlFor={inputId} className="block text-xs sm:text-sm font-bold text-gray-700">
          {label} {required && <span className="text-teal-600">*</span>}
        </label>
        {showStrengthMeter && value && (
          <span className={`text-[11px] font-black uppercase tracking-wider ${strength.color} flex items-center gap-1`}>
            {strength.score >= 3 ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
            Força: {strength.label}
          </span>
        )}
      </div>

      <div className="relative">
        <input
          id={inputId}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className={`appearance-none block w-full px-4 py-3 pr-11 bg-white border-2 ${
            error 
              ? 'border-red-400 focus:border-red-500' 
              : showStrengthMeter && value && strength.score >= 3
                ? 'border-emerald-200 focus:border-emerald-500'
                : 'border-gray-200 focus:border-teal-500'
          } rounded-2xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all text-sm font-medium shadow-2xs`}
          {...props}
        />

        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={showPassword ? 'Ocultar senha' : 'Ver senha'}
          title={showPassword ? 'Ocultar senha' : 'Ver senha'}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all"
        >
          {showPassword ? (
            <EyeOff size={18} className="text-teal-700" />
          ) : (
            <Eye size={18} className="text-gray-400" />
          )}
        </button>
      </div>

      {error && (
        <p className="mt-1.5 text-xs text-red-500 font-medium ml-1 flex items-center gap-1">
          <X size={13} />
          {error}
        </p>
      )}

      {/* Barra visual de força da senha estilo apps modernos */}
      {showStrengthMeter && value && (
        <div className="mt-2.5 space-y-2 p-3 bg-gray-50/80 rounded-2xl border border-gray-100 animate-fade-in">
          {/* Barra de 4 segmentos */}
          <div className="grid grid-cols-4 gap-1.5 h-1.5">
            {[1, 2, 3, 4].map(seg => {
              const isActive = strength.score >= seg;
              let segBg = 'bg-gray-200';
              if (isActive) {
                if (strength.score === 1) segBg = 'bg-red-500';
                else if (strength.score === 2) segBg = 'bg-amber-500';
                else if (strength.score === 3) segBg = 'bg-teal-500';
                else segBg = 'bg-emerald-500';
              }
              return (
                <div
                  key={seg}
                  className={`h-full rounded-full transition-all duration-300 ${segBg}`}
                />
              );
            })}
          </div>

          {/* Checklist interativo de critérios modernos de segurança */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] pt-1 text-gray-600">
            <div className={`flex items-center gap-1.5 ${strength.rules.minLength ? 'text-emerald-700 font-bold' : 'text-gray-500'}`}>
              {strength.rules.minLength ? (
                <Check size={13} className="text-emerald-600 shrink-0 stroke-[3]" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block shrink-0" />
              )}
              <span>Mínimo de 8 caracteres</span>
            </div>

            <div className={`flex items-center gap-1.5 ${strength.rules.hasUpper && strength.rules.hasLower ? 'text-emerald-700 font-bold' : 'text-gray-500'}`}>
              {strength.rules.hasUpper && strength.rules.hasLower ? (
                <Check size={13} className="text-emerald-600 shrink-0 stroke-[3]" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block shrink-0" />
              )}
              <span>Maiúsculas e minúsculas (Aa)</span>
            </div>

            <div className={`flex items-center gap-1.5 ${strength.rules.hasNumber ? 'text-emerald-700 font-bold' : 'text-gray-500'}`}>
              {strength.rules.hasNumber ? (
                <Check size={13} className="text-emerald-600 shrink-0 stroke-[3]" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block shrink-0" />
              )}
              <span>Pelo menos um número (0-9)</span>
            </div>

            <div className={`flex items-center gap-1.5 ${strength.rules.hasSpecial ? 'text-emerald-700 font-bold' : 'text-gray-500'}`}>
              {strength.rules.hasSpecial ? (
                <Check size={13} className="text-emerald-600 shrink-0 stroke-[3]" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block shrink-0" />
              )}
              <span>Caractere especial (!@#$%)</span>
            </div>
          </div>
        </div>
      )}

      {helperText && !showStrengthMeter && (
        <p className="mt-1 text-xs text-gray-400 ml-1">{helperText}</p>
      )}
    </div>
  );
};

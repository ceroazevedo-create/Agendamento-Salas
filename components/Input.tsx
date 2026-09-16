import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className={`mb-5 ${className}`}>
      <label className="block text-sm font-bold text-gray-700 mb-2 ml-1">
        {label}
      </label>
      <input
        className={`appearance-none block w-full px-4 py-3 bg-white border-2 ${error ? 'border-red-400' : 'border-gray-100'} rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all sm:text-sm`}
        {...props}
      />
      {error && <p className="mt-2 text-sm text-red-500 font-medium ml-1">{error}</p>}
    </div>
  );
};